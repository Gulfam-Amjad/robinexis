import { poolSsl } from "./env.js";
import pg from "pg";
import { sortClientsForDashboard } from "./clientOrder.js";
import type { PlatformStore } from "./memory.js";
import type {
  AgentInstance,
  AnalyticsRange,
  AnalyticsSummary,
  AnalyticsTimeseriesPoint,
  BookingRecord,
  CalendarConnection,
  CalendarEventType,
  CallListOptions,
  CallNote,
  CallSession,
  ClientConfig,
  ClientConfigRevision,
  CreditLedgerEntry,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentListOptions,
  KnowledgeSearchOptions,
  Location,
  OperatorAuditRecord,
  OutboundJob,
  Page,
  PhoneEndpoint,
  PromptVersion,
  ProvisioningRun,
  StripeEvent,
  Subscription,
  Suppression,
  ToolActionRow,
  TwilioConnection,
  UsageCounters,
  UserProfile,
  WorkspaceMembership,
} from "./types.js";

export class PostgresStore implements PlatformStore {
  constructor(private pool: pg.Pool) {}

  async getClient(id: string) {
    const r = await this.pool.query("SELECT config FROM clients WHERE id = $1", [id]);
    return r.rows[0]?.config as ClientConfig | undefined;
  }
  async getClientBySlug(slug: string) {
    const r = await this.pool.query("SELECT config FROM clients WHERE slug = $1", [slug]);
    return r.rows[0]?.config as ClientConfig | undefined;
  }
  async getClientByInboundNumber(e164: string) {
    const r = await this.pool.query(`SELECT config FROM clients`);
    const n = e164.replace(/\s/g, "");
    for (const row of r.rows) {
      const c = row.config as ClientConfig;
      if (c.inboundNumbers?.some((x) => x.replace(/\s/g, "") === n)) return c;
    }
    return undefined;
  }
  async getClientByElevenLabsAgentId(agentId: string) {
    const r = await this.pool.query(
      `SELECT c.config
       FROM clients c
       LEFT JOIN agent_instances a
         ON a.client_id = c.id AND a.provider_agent_id = $1
       WHERE a.provider_agent_id = $1 OR c.config->>'elevenlabsAgentId' = $1
       LIMIT 1`,
      [agentId],
    );
    return r.rows[0]?.config as ClientConfig | undefined;
  }
  async listClients() {
    const r = await this.pool.query("SELECT config FROM clients ORDER BY slug");
    return sortClientsForDashboard(r.rows.map((row) => row.config as ClientConfig));
  }
  async upsertClient(c: ClientConfig) {
    await this.pool.query(
      `INSERT INTO clients (id, slug, config) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, config = EXCLUDED.config`,
      [c.id, c.slug, c],
    );
  }
  async getDraftClient(clientId: string) {
    const r = await this.pool.query(
      `SELECT * FROM client_config_revisions
       WHERE client_id = $1 AND status = 'draft'
       ORDER BY updated_at DESC LIMIT 1`,
      [clientId],
    );
    return r.rows[0] ? clientRevisionFromRow(r.rows[0]) : undefined;
  }
  async saveDraftClient(revision: ClientConfigRevision) {
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        `UPDATE client_config_revisions
         SET status = 'superseded', updated_at = $2
         WHERE client_id = $1 AND status = 'draft' AND id <> $3`,
        [revision.clientId, revision.updatedAt, revision.id],
      );
      await connection.query(
        `INSERT INTO client_config_revisions
         (id, client_id, status, config, created_by, created_at, updated_at, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config,
           created_by = EXCLUDED.created_by, updated_at = EXCLUDED.updated_at
         WHERE client_config_revisions.client_id = EXCLUDED.client_id
           AND client_config_revisions.status = 'draft'`,
        [
          revision.id, revision.clientId, revision.status, revision.config,
          revision.createdBy ?? null, revision.createdAt, revision.updatedAt,
          revision.publishedAt ?? null,
        ],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }
  async publishClientDraft(revision: ClientConfigRevision, prompt: PromptVersion) {
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        `INSERT INTO client_config_revisions
         (id, client_id, status, config, created_by, created_at, updated_at)
         VALUES ($1,$2,'draft',$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          revision.id, revision.clientId, revision.config,
          revision.createdBy ?? null, revision.createdAt, revision.updatedAt,
        ],
      );
      await connection.query(
        `INSERT INTO prompt_versions (id, client_id, version, compiled)
         VALUES ($1,$2,$3,$4)`,
        [prompt.id, prompt.clientId, prompt.version, prompt.compiled],
      );
      const updated = await connection.query(
        `UPDATE clients SET slug = $2, config = $3
         WHERE id = $1 RETURNING id`,
        [revision.clientId, revision.config.slug, revision.config],
      );
      if (updated.rowCount !== 1) throw new Error("client_not_found");
      await connection.query(
        `UPDATE client_config_revisions
         SET status = CASE WHEN id = $2 THEN 'published' ELSE 'superseded' END,
             published_at = CASE WHEN id = $2 THEN now() ELSE published_at END,
             updated_at = now()
         WHERE client_id = $1 AND status = 'draft'`,
        [revision.clientId, revision.id],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }
  async getPublishedClient(idOrSlug: string) {
    const c = (await this.getClient(idOrSlug)) ?? (await this.getClientBySlug(idOrSlug));
    return c?.published ? c : undefined;
  }
  async listMembershipsForEmail(email: string) {
    const r = await this.pool.query(
      `SELECT id, client_id, email, role, created_at
       FROM workspace_memberships WHERE email = lower($1) ORDER BY created_at`,
      [email.trim()],
    );
    return r.rows.map(membershipFromRow);
  }
  async listMembershipsForClient(clientId: string) {
    const r = await this.pool.query(
      `SELECT id, client_id, email, role, created_at
       FROM workspace_memberships WHERE client_id = $1 ORDER BY created_at`,
      [clientId],
    );
    return r.rows.map(membershipFromRow);
  }
  async upsertMembership(membership: WorkspaceMembership) {
    await this.pool.query(
      `INSERT INTO workspace_memberships (id, client_id, email, role, created_at)
       VALUES ($1, $2, lower($3), $4, $5)
       ON CONFLICT (client_id, email) DO UPDATE SET role = EXCLUDED.role`,
      [
        membership.id,
        membership.clientId,
        membership.email.trim(),
        membership.role,
        membership.createdAt,
      ],
    );
  }
  async deleteMembership(clientId: string, membershipId: string) {
    const r = await this.pool.query(
      "DELETE FROM workspace_memberships WHERE client_id = $1 AND id = $2",
      [clientId, membershipId],
    );
    return Boolean(r.rowCount);
  }
  async getUserProfile(clientId: string, authUserId: string) {
    const r = await this.pool.query(
      "SELECT * FROM user_profiles WHERE client_id = $1 AND auth_user_id = $2",
      [clientId, authUserId],
    );
    return r.rows[0] ? userProfileFromRow(r.rows[0]) : undefined;
  }
  async getUserProfileByAuthUserId(authUserId: string) {
    const r = await this.pool.query(
      "SELECT * FROM user_profiles WHERE auth_user_id = $1 LIMIT 1",
      [authUserId],
    );
    return r.rows[0] ? userProfileFromRow(r.rows[0]) : undefined;
  }
  async listUserProfilesForAuthUser(authUserId: string) {
    const r = await this.pool.query(
      "SELECT * FROM user_profiles WHERE auth_user_id = $1 ORDER BY created_at, id",
      [authUserId],
    );
    return r.rows.map(userProfileFromRow);
  }
  async listUserProfiles(clientId: string) {
    const r = await this.pool.query(
      "SELECT * FROM user_profiles WHERE client_id = $1 ORDER BY created_at, id",
      [clientId],
    );
    return r.rows.map(userProfileFromRow);
  }
  async upsertUserProfile(profile: UserProfile) {
    await this.pool.query(
      `INSERT INTO user_profiles
       (id, client_id, auth_user_id, email, display_name, platform_role, workspace_role, created_at, updated_at)
       VALUES ($1,$2,$3,lower($4),$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, auth_user_id = EXCLUDED.auth_user_id,
         email = EXCLUDED.email, display_name = EXCLUDED.display_name,
         platform_role = EXCLUDED.platform_role, workspace_role = EXCLUDED.workspace_role,
         updated_at = EXCLUDED.updated_at`,
      [profile.id, profile.clientId ?? null, profile.authUserId, profile.email.trim(),
        profile.displayName ?? null, profile.platformRole, profile.workspaceRole ?? null,
        profile.createdAt, profile.updatedAt],
    );
  }
  async getLocation(clientId: string, id: string) {
    const r = await this.pool.query("SELECT * FROM locations WHERE client_id = $1 AND id = $2", [clientId, id]);
    return r.rows[0] ? locationFromRow(r.rows[0]) : undefined;
  }
  async listLocations(clientId: string) {
    const r = await this.pool.query("SELECT * FROM locations WHERE client_id = $1 ORDER BY is_primary DESC, name", [clientId]);
    return r.rows.map(locationFromRow);
  }
  async upsertLocation(location: Location) {
    await this.pool.query(
      `INSERT INTO locations
       (id, client_id, slug, name, timezone, phone, address, is_primary, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name,
         timezone = EXCLUDED.timezone, phone = EXCLUDED.phone, address = EXCLUDED.address,
         is_primary = EXCLUDED.is_primary, updated_at = EXCLUDED.updated_at
       WHERE locations.client_id = EXCLUDED.client_id`,
      [location.id, location.clientId, location.slug, location.name, location.timezone,
        location.phone ?? null, location.address ?? {}, location.isPrimary, location.createdAt, location.updatedAt],
    );
  }
  async getAgentInstance(clientId: string, id: string) {
    const r = await this.pool.query("SELECT * FROM agent_instances WHERE client_id = $1 AND id = $2", [clientId, id]);
    return r.rows[0] ? agentInstanceFromRow(r.rows[0]) : undefined;
  }
  async getAgentInstanceByProviderAgentId(providerAgentId: string) {
    const r = await this.pool.query(
      "SELECT * FROM agent_instances WHERE provider_agent_id = $1 LIMIT 1",
      [providerAgentId],
    );
    return r.rows[0] ? agentInstanceFromRow(r.rows[0]) : undefined;
  }
  async getAgentInstanceByVoiceCredentialHash(hash: string) {
    const r = await this.pool.query(
      "SELECT * FROM agent_instances WHERE voice_credential_hash = $1 LIMIT 1",
      [hash],
    );
    return r.rows[0] ? agentInstanceFromRow(r.rows[0]) : undefined;
  }
  async listAgentInstances(clientId: string) {
    const r = await this.pool.query("SELECT * FROM agent_instances WHERE client_id = $1 ORDER BY created_at, id", [clientId]);
    return r.rows.map(agentInstanceFromRow);
  }
  async upsertAgentInstance(agent: AgentInstance) {
    await this.pool.query(
      `INSERT INTO agent_instances
       (id, client_id, location_id, provider, provider_agent_id, voice_credential_hash,
        provider_secret_id, name, status, config, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET location_id = EXCLUDED.location_id, provider = EXCLUDED.provider,
         provider_agent_id = EXCLUDED.provider_agent_id,
         voice_credential_hash = EXCLUDED.voice_credential_hash,
         provider_secret_id = EXCLUDED.provider_secret_id,
         name = EXCLUDED.name, status = EXCLUDED.status,
         config = EXCLUDED.config, updated_at = EXCLUDED.updated_at
       WHERE agent_instances.client_id = EXCLUDED.client_id`,
      [agent.id, agent.clientId, agent.locationId ?? null, agent.provider, agent.providerAgentId ?? null,
        agent.voiceCredentialHash ?? null, agent.providerSecretId ?? null, agent.name, agent.status,
        agent.config, agent.createdAt, agent.updatedAt],
    );
  }
  async listPhoneEndpoints(clientId: string) {
    const r = await this.pool.query("SELECT * FROM phone_endpoints WHERE client_id = $1 ORDER BY created_at, id", [clientId]);
    return r.rows.map(phoneEndpointFromRow);
  }
  async upsertPhoneEndpoint(endpoint: PhoneEndpoint) {
    await this.pool.query(
      `INSERT INTO phone_endpoints
       (id, client_id, location_id, agent_instance_id, provider, e164, provider_endpoint_id,
        direction, status, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET location_id = EXCLUDED.location_id,
         agent_instance_id = EXCLUDED.agent_instance_id, provider = EXCLUDED.provider,
         e164 = EXCLUDED.e164, provider_endpoint_id = EXCLUDED.provider_endpoint_id,
         direction = EXCLUDED.direction, status = EXCLUDED.status, metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at
       WHERE phone_endpoints.client_id = EXCLUDED.client_id`,
      [endpoint.id, endpoint.clientId, endpoint.locationId ?? null, endpoint.agentInstanceId ?? null,
        endpoint.provider, endpoint.e164, endpoint.providerEndpointId ?? null, endpoint.direction,
        endpoint.status, endpoint.metadata, endpoint.createdAt, endpoint.updatedAt],
    );
  }
  async getTwilioConnection(clientId: string) {
    const r = await this.pool.query(
      "SELECT * FROM twilio_connections WHERE client_id = $1",
      [clientId],
    );
    return r.rows[0] ? twilioConnectionFromRow(r.rows[0]) : undefined;
  }
  async upsertTwilioConnection(connection: TwilioConnection) {
    await this.pool.query(
      `INSERT INTO twilio_connections
       (id, client_id, mode, account_sid, encrypted_access_token, encrypted_refresh_token,
        access_token_expires_at, api_key_sid, encrypted_api_key_secret,
        status, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (client_id) DO UPDATE SET
         mode = EXCLUDED.mode, account_sid = EXCLUDED.account_sid,
         encrypted_access_token = EXCLUDED.encrypted_access_token,
         encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         api_key_sid = EXCLUDED.api_key_sid,
         encrypted_api_key_secret = EXCLUDED.encrypted_api_key_secret,
         status = EXCLUDED.status, metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [connection.id, connection.clientId, connection.mode, connection.accountSid ?? null,
        connection.encryptedAccessToken ?? null, connection.encryptedRefreshToken ?? null,
        connection.accessTokenExpiresAt ?? null, connection.apiKeySid ?? null,
        connection.encryptedApiKeySecret ?? null, connection.status, connection.metadata,
        connection.createdAt, connection.updatedAt],
    );
  }
  async deleteTwilioConnection(clientId: string) {
    await this.pool.query("DELETE FROM twilio_connections WHERE client_id = $1", [clientId]);
  }
  async listCalendarConnections(clientId: string) {
    const r = await this.pool.query("SELECT * FROM calendar_connections WHERE client_id = $1 ORDER BY created_at, id", [clientId]);
    return r.rows.map(calendarConnectionFromRow);
  }
  async upsertCalendarConnection(connection: CalendarConnection) {
    await this.pool.query(
      `INSERT INTO calendar_connections
       (id, client_id, location_id, provider, external_account_id, credential_ref, calendar_id,
        status, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET location_id = EXCLUDED.location_id, provider = EXCLUDED.provider,
         external_account_id = EXCLUDED.external_account_id, credential_ref = EXCLUDED.credential_ref,
         calendar_id = EXCLUDED.calendar_id, status = EXCLUDED.status, metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at
       WHERE calendar_connections.client_id = EXCLUDED.client_id`,
      [connection.id, connection.clientId, connection.locationId ?? null, connection.provider,
        connection.externalAccountId ?? null, connection.credentialRef, connection.calendarId ?? null,
        connection.status, connection.metadata, connection.createdAt, connection.updatedAt],
    );
  }
  async listCalendarEventTypes(clientId: string) {
    const r = await this.pool.query(
      "SELECT * FROM calendar_event_types WHERE client_id = $1 ORDER BY created_at, id",
      [clientId],
    );
    return r.rows.map(calendarEventTypeFromRow);
  }
  async upsertCalendarEventType(eventType: CalendarEventType) {
    await this.pool.query(
      `INSERT INTO calendar_event_types
       (id, client_id, calendar_connection_id, service_slug, provider_event_type_id,
        provider_slug, title, duration_minutes, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (client_id, service_slug) DO UPDATE SET
         calendar_connection_id = EXCLUDED.calendar_connection_id,
         provider_event_type_id = EXCLUDED.provider_event_type_id,
         provider_slug = EXCLUDED.provider_slug, title = EXCLUDED.title,
         duration_minutes = EXCLUDED.duration_minutes, status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [eventType.id, eventType.clientId, eventType.calendarConnectionId, eventType.serviceSlug,
        eventType.providerEventTypeId, eventType.providerSlug, eventType.title,
        eventType.durationMinutes, eventType.status, eventType.createdAt, eventType.updatedAt],
    );
  }
  async getCurrentSubscription(clientId: string) {
    const r = await this.pool.query(
      "SELECT * FROM subscriptions WHERE client_id = $1 ORDER BY updated_at DESC, id DESC LIMIT 1",
      [clientId],
    );
    return r.rows[0] ? subscriptionFromRow(r.rows[0]) : undefined;
  }
  async upsertSubscription(subscription: Subscription) {
    await this.pool.query(
      `INSERT INTO subscriptions
       (id, client_id, provider, provider_customer_id, provider_subscription_id, plan_tier,
        status, price_id, trial_ends_at, current_period_start, current_period_end,
        cancel_at_period_end, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET provider_customer_id = EXCLUDED.provider_customer_id,
         provider_subscription_id = EXCLUDED.provider_subscription_id, status = EXCLUDED.status,
         provider = EXCLUDED.provider, plan_tier = EXCLUDED.plan_tier,
         price_id = EXCLUDED.price_id, trial_ends_at = EXCLUDED.trial_ends_at,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
         metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
       WHERE subscriptions.client_id = EXCLUDED.client_id`,
      [subscription.id, subscription.clientId, subscription.provider, subscription.providerCustomerId ?? null,
        subscription.providerSubscriptionId ?? null, subscription.planTier, subscription.status,
        subscription.priceId ?? null, subscription.trialEndsAt ?? null,
        subscription.currentPeriodStart ?? null, subscription.currentPeriodEnd ?? null,
        subscription.cancelAtPeriodEnd, subscription.metadata, subscription.createdAt,
        subscription.updatedAt],
    );
  }
  async claimStripeEvent(event: StripeEvent) {
    const r = await this.pool.query(
      `INSERT INTO stripe_events
       (id, client_id, event_type, livemode, payload, status, error, received_at, processed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [event.id, event.clientId ?? null, event.eventType, event.livemode, event.payload, event.status,
        event.error ?? null, event.receivedAt, event.processedAt ?? null],
    );
    return r.rowCount === 1;
  }
  async saveStripeEvent(event: StripeEvent) {
    await this.pool.query(
      `INSERT INTO stripe_events
       (id, client_id, event_type, livemode, payload, status, error, received_at, processed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, error = EXCLUDED.error,
         processed_at = EXCLUDED.processed_at WHERE stripe_events.client_id = EXCLUDED.client_id`,
      [event.id, event.clientId ?? null, event.eventType, event.livemode, event.payload, event.status,
        event.error ?? null, event.receivedAt, event.processedAt ?? null],
    );
  }
  async getStripeEvent(clientId: string, id: string) {
    const r = await this.pool.query("SELECT * FROM stripe_events WHERE client_id = $1 AND id = $2", [clientId, id]);
    return r.rows[0] ? stripeEventFromRow(r.rows[0]) : undefined;
  }
  async listStripeEvents(status?: StripeEvent["status"], limit = 100) {
    const r = await this.pool.query(
      `SELECT * FROM stripe_events
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY received_at DESC, id DESC LIMIT $2`,
      [status ?? null, Math.max(1, Math.min(limit, 500))],
    );
    return r.rows.map(stripeEventFromRow);
  }
  async saveBookingRecord(booking: BookingRecord) {
    await this.pool.query(
      `INSERT INTO booking_records
       (id, client_id, location_id, calendar_connection_id, call_id, provider, provider_booking_id,
        idempotency_key, status, starts_at, ends_at, attendee_name, attendee_phone, attendee_email,
        service_slug, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET provider_booking_id = EXCLUDED.provider_booking_id,
         status = EXCLUDED.status, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
         attendee_name = EXCLUDED.attendee_name, attendee_phone = EXCLUDED.attendee_phone,
         attendee_email = EXCLUDED.attendee_email, service_slug = EXCLUDED.service_slug,
         metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
       WHERE booking_records.client_id = EXCLUDED.client_id`,
      [booking.id, booking.clientId, booking.locationId ?? null, booking.calendarConnectionId ?? null,
        booking.callId ?? null, booking.provider, booking.providerBookingId ?? null,
        booking.idempotencyKey ?? null, booking.status, booking.startsAt, booking.endsAt,
        booking.attendeeName ?? null, booking.attendeePhone ?? null, booking.attendeeEmail ?? null,
        booking.serviceSlug ?? null, booking.metadata, booking.createdAt, booking.updatedAt],
    );
  }
  async findBookingByIdempotency(clientId: string, key: string) {
    const r = await this.pool.query(
      "SELECT * FROM booking_records WHERE client_id = $1 AND idempotency_key = $2",
      [clientId, key],
    );
    return r.rows[0] ? bookingRecordFromRow(r.rows[0]) : undefined;
  }
  async listBookingRecords(clientId: string) {
    const r = await this.pool.query(
      "SELECT * FROM booking_records WHERE client_id = $1 ORDER BY starts_at DESC, id DESC",
      [clientId],
    );
    return r.rows.map(bookingRecordFromRow);
  }
  async appendCreditLedgerEntry(entry: CreditLedgerEntry) {
    const r = await this.pool.query(
      `INSERT INTO credit_ledger
       (id, client_id, minutes, kind, direction, reference_type, reference_id, description, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
      [entry.id, entry.clientId, entry.minutes, entry.kind, entry.direction ?? null,
        entry.referenceType ?? null, entry.referenceId ?? null, entry.description ?? null,
        entry.createdAt],
    );
    return r.rowCount === 1;
  }
  async listCreditLedger(clientId: string) {
    const r = await this.pool.query(
      "SELECT * FROM credit_ledger WHERE client_id = $1 ORDER BY created_at DESC, id DESC",
      [clientId],
    );
    return r.rows.map(creditLedgerEntryFromRow);
  }
  async getCreditBalance(clientId: string) {
    const r = await this.pool.query(
      "SELECT COALESCE(sum(minutes), 0) AS balance FROM credit_ledger WHERE client_id = $1",
      [clientId],
    );
    return Number(r.rows[0]?.balance ?? 0);
  }
  async appendOperatorAudit(record: OperatorAuditRecord) {
    const r = await this.pool.query(
      `INSERT INTO operator_audit_log (id, client_id, actor_id, action, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
      [record.id, record.clientId ?? null, record.actorId, record.action, record.detail, record.createdAt],
    );
    return r.rowCount === 1;
  }
  async listOperatorAudit(clientId?: string, limit = 100) {
    const r = await this.pool.query(
      `SELECT * FROM operator_audit_log
       WHERE ($1::text IS NULL OR client_id = $1)
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [clientId ?? null, Math.max(1, Math.min(limit, 500))],
    );
    return r.rows.map(operatorAuditFromRow);
  }
  async claimProvisioningRun(run: ProvisioningRun) {
    const r = await this.pool.query(
      `INSERT INTO provisioning_runs
       (id, client_id, idempotency_key, status, step, input, output, error, started_at,
        finished_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (client_id, idempotency_key) DO NOTHING RETURNING id`,
      [run.id, run.clientId, run.idempotencyKey, run.status, run.step ?? null, run.input,
        run.output ?? null, run.error ?? null, run.startedAt ?? null, run.finishedAt ?? null,
        run.createdAt, run.updatedAt],
    );
    return r.rowCount === 1;
  }
  async saveProvisioningRun(run: ProvisioningRun) {
    await this.pool.query(
      `INSERT INTO provisioning_runs
       (id, client_id, idempotency_key, status, step, input, output, error, started_at,
        finished_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, step = EXCLUDED.step,
         output = EXCLUDED.output, error = EXCLUDED.error, started_at = EXCLUDED.started_at,
         finished_at = EXCLUDED.finished_at, updated_at = EXCLUDED.updated_at
       WHERE provisioning_runs.client_id = EXCLUDED.client_id`,
      [run.id, run.clientId, run.idempotencyKey, run.status, run.step ?? null, run.input,
        run.output ?? null, run.error ?? null, run.startedAt ?? null, run.finishedAt ?? null,
        run.createdAt, run.updatedAt],
    );
  }
  async getProvisioningRun(clientId: string, id: string) {
    const r = await this.pool.query("SELECT * FROM provisioning_runs WHERE client_id = $1 AND id = $2", [clientId, id]);
    return r.rows[0] ? provisioningRunFromRow(r.rows[0]) : undefined;
  }
  async getProvisioningRunByIdempotency(clientId: string, key: string) {
    const r = await this.pool.query(
      "SELECT * FROM provisioning_runs WHERE client_id = $1 AND idempotency_key = $2",
      [clientId, key],
    );
    return r.rows[0] ? provisioningRunFromRow(r.rows[0]) : undefined;
  }
  async listProvisioningRuns(clientId: string) {
    const r = await this.pool.query(
      "SELECT * FROM provisioning_runs WHERE client_id = $1 ORDER BY created_at DESC, id DESC",
      [clientId],
    );
    return r.rows.map(provisioningRunFromRow);
  }
  async getPromptVersion(id: string) {
    const r = await this.pool.query(
      "SELECT id, client_id, version, compiled, created_at FROM prompt_versions WHERE id = $1",
      [id],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      clientId: row.client_id,
      version: row.version,
      compiled: row.compiled,
      createdAt: row.created_at.toISOString?.() ?? String(row.created_at),
    } as PromptVersion;
  }
  async latestPrompt(clientId: string) {
    const r = await this.pool.query(
      "SELECT id, client_id, version, compiled, created_at FROM prompt_versions WHERE client_id = $1 ORDER BY version DESC LIMIT 1",
      [clientId],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      clientId: row.client_id,
      version: row.version,
      compiled: row.compiled,
      createdAt: row.created_at.toISOString?.() ?? String(row.created_at),
    } as PromptVersion;
  }
  async listPromptVersions(clientId: string, limit = 50) {
    const r = await this.pool.query(
      `SELECT id, client_id, version, compiled, created_at
       FROM prompt_versions WHERE client_id = $1 ORDER BY version DESC LIMIT $2`,
      [clientId, Math.max(1, Math.min(limit, 200))],
    );
    return r.rows.map(promptFromRow);
  }
  async savePromptVersion(p: PromptVersion) {
    await this.pool.query(
      `INSERT INTO prompt_versions (id, client_id, version, compiled) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET compiled = EXCLUDED.compiled, version = EXCLUDED.version`,
      [p.id, p.clientId, p.version, p.compiled],
    );
  }
  async saveCall(c: CallSession) {
    await this.pool.query(
      `INSERT INTO call_sessions (id, client_id, payload, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [c.id, c.clientId, c],
    );
  }
  async getCall(id: string) {
    const r = await this.pool.query("SELECT payload FROM call_sessions WHERE id = $1", [id]);
    return r.rows[0]?.payload as CallSession | undefined;
  }
  async getCallForClient(clientId: string, id: string) {
    const r = await this.pool.query(
      "SELECT payload FROM call_sessions WHERE client_id = $1 AND id = $2",
      [clientId, id],
    );
    return r.rows[0]?.payload as CallSession | undefined;
  }
  async getCallByTwilioSid(clientId: string, twilioCallSid: string) {
    const sid = twilioCallSid.trim();
    if (!sid) return undefined;
    const r = await this.pool.query(
      `SELECT payload FROM call_sessions
       WHERE client_id = $1 AND payload->>'twilioCallSid' = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [clientId, sid],
    );
    return r.rows[0]?.payload as CallSession | undefined;
  }
  async listCallsForClient(clientId: string, limit?: number): Promise<CallSession[]>;
  async listCallsForClient(clientId: string, options: CallListOptions): Promise<Page<CallSession>>;
  async listCallsForClient(
    clientId: string,
    options: number | CallListOptions = 50,
  ): Promise<CallSession[] | Page<CallSession>> {
    if (typeof options === "number") {
      const r = await this.pool.query(
        "SELECT payload FROM call_sessions WHERE client_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2",
        [clientId, options],
      );
      return r.rows.map((row) => row.payload as CallSession);
    }
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const values: unknown[] = [clientId];
    const where = ["client_id = $1"];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    if (options.direction) add("payload->>'direction' = ?", options.direction);
    if (options.status) add("payload->>'status' = ?", options.status);
    if (options.outcome) add("payload->>'outcome' = ?", options.outcome);
    if (options.from) add("created_at >= ?::timestamptz", options.from);
    if (options.to) add("created_at <= ?::timestamptz", options.to);
    if (options.cursor) {
      const separator = options.cursor.lastIndexOf("|");
      const updatedAt = separator > 0 ? options.cursor.slice(0, separator) : options.cursor;
      const id = separator > 0 ? options.cursor.slice(separator + 1) : "";
      values.push(updatedAt, id);
      where.push(`(updated_at, id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }
    values.push(limit + 1);
    const r = await this.pool.query(
      `SELECT id, payload, updated_at FROM call_sessions
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC, id DESC LIMIT $${values.length}`,
      values,
    );
    const items = r.rows.slice(0, limit).map((row) => row.payload as CallSession);
    const last = r.rows[Math.min(limit, r.rows.length) - 1];
    return {
      items,
      nextCursor:
        r.rows.length > limit && last
          ? `${toIso(last.updated_at)}|${last.id}`
          : undefined,
    };
  }
  async getAnalyticsSummary(clientId: string, range: AnalyticsRange) {
    const calls = await this.analyticsCalls(clientId, range);
    return analyticsSummary(clientId, range, calls);
  }
  async getAnalyticsTimeseries(clientId: string, range: AnalyticsRange) {
    return analyticsTimeseries(await this.analyticsCalls(clientId, range));
  }
  async saveToolAction(row: ToolActionRow) {
    await this.pool.query(
      `INSERT INTO tool_actions (id, call_id, client_id, name, input, result, error, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         result = EXCLUDED.result,
         error = EXCLUDED.error`,
      [row.id, row.callId, row.clientId, row.name, row.input, row.result, row.error ?? null, row.idempotencyKey ?? null],
    );
  }
  async claimToolAction(row: ToolActionRow) {
    const r = await this.pool.query(
      `INSERT INTO tool_actions (id, call_id, client_id, name, input, result, error, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [row.id, row.callId, row.clientId, row.name, row.input, row.result, row.error ?? null, row.idempotencyKey],
    );
    return r.rowCount === 1;
  }
  async findToolByIdempotency(clientId: string, key: string) {
    const r = await this.pool.query(
      "SELECT * FROM tool_actions WHERE client_id = $1 AND idempotency_key = $2 ORDER BY at DESC LIMIT 1",
      [clientId, key],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      callId: row.call_id,
      clientId: row.client_id,
      name: row.name,
      input: row.input,
      result: row.result,
      error: row.error,
      idempotencyKey: row.idempotency_key,
      at: row.at?.toISOString?.() ?? new Date().toISOString(),
    } as ToolActionRow;
  }
  async listToolActionsForCall(clientId: string, callId: string) {
    const r = await this.pool.query(
      `SELECT id, call_id, client_id, name, input, result, error, idempotency_key, at
       FROM tool_actions WHERE client_id = $1 AND call_id = $2 ORDER BY at, id`,
      [clientId, callId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      callId: row.call_id,
      clientId: row.client_id,
      name: row.name,
      input: row.input,
      result: row.result,
      error: row.error ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      at: toIso(row.at),
    }));
  }
  async saveJob(j: OutboundJob) {
    await this.pool.query(
      `INSERT INTO outbound_jobs (id, client_id, payload) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload
       WHERE outbound_jobs.client_id = EXCLUDED.client_id`,
      [j.id, j.clientId, j],
    );
  }
  async getJob(id: string) {
    const r = await this.pool.query("SELECT payload FROM outbound_jobs WHERE id = $1", [id]);
    return r.rows[0]?.payload as OutboundJob | undefined;
  }
  async getJobForClient(clientId: string, id: string) {
    const r = await this.pool.query(
      "SELECT payload FROM outbound_jobs WHERE client_id = $1 AND id = $2",
      [clientId, id],
    );
    return r.rows[0]?.payload as OutboundJob | undefined;
  }
  async listJobs(clientId?: string) {
    const r = clientId
      ? await this.pool.query("SELECT payload FROM outbound_jobs WHERE client_id = $1", [clientId])
      : await this.pool.query("SELECT payload FROM outbound_jobs");
    return r.rows.map((row) => row.payload as OutboundJob);
  }
  async claimJob(id: string, attemptedAt: string) {
    const r = await this.pool.query(
      `UPDATE outbound_jobs
       SET payload = jsonb_set(
         jsonb_set(
           jsonb_set(payload, '{status}', '"dialing"'::jsonb),
           '{attemptCount}', to_jsonb(COALESCE((payload->>'attemptCount')::int, 0) + 1)
         ),
         '{lastAttemptAt}', to_jsonb($2::text)
       )
       WHERE id = $1 AND payload->>'status' = 'approved' AND payload->>'approved' = 'true'
       RETURNING id`,
      [id, attemptedAt],
    );
    return r.rowCount === 1;
  }
  async dueJobs(nowIso: string, limit: number) {
    const r = await this.pool.query(
      `SELECT payload FROM outbound_jobs
       WHERE payload->>'status' IN ('pending', 'approved')
         AND (payload->>'scheduledAt')::timestamptz <= $1::timestamptz
       ORDER BY (payload->>'scheduledAt')::timestamptz, id LIMIT $2`,
      [nowIso, limit],
    );
    return r.rows.map((row) => row.payload as OutboundJob);
  }
  async cancelJob(id: string, clientId?: string) {
    const values: unknown[] = [id];
    const tenantClause = clientId ? "AND client_id = $2" : "";
    if (clientId) values.push(clientId);
    const r = await this.pool.query(
      `UPDATE outbound_jobs
       SET payload = jsonb_set(jsonb_set(payload, '{status}', '"cancelled"'::jsonb), '{approved}', 'false'::jsonb)
       WHERE id = $1 ${tenantClause}
         AND payload->>'status' NOT IN ('completed', 'cancelled')
       RETURNING id`,
      values,
    );
    return r.rowCount === 1;
  }
  async addSuppression(s: Suppression) {
    await this.pool.query(
      `INSERT INTO suppressions (client_id, phone, reason) VALUES ($1, $2, $3)
       ON CONFLICT (client_id, phone) DO UPDATE SET reason = EXCLUDED.reason`,
      [s.clientId, s.phone, s.reason],
    );
  }
  async isSuppressed(clientId: string, phone: string) {
    const r = await this.pool.query("SELECT 1 FROM suppressions WHERE client_id = $1 AND phone = $2", [
      clientId,
      phone,
    ]);
    return r.rowCount !== 0;
  }
  async saveNote(n: CallNote) {
    await this.pool.query(
      `INSERT INTO call_notes (id, client_id, payload) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload
       WHERE call_notes.client_id = EXCLUDED.client_id`,
      [n.id, n.clientId, n],
    );
  }
  async addUsage(clientId: string, inboundMin: number, outboundMin: number) {
    const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    await this.pool.query(
      `INSERT INTO usage_counters (client_id, month, inbound_minutes, outbound_minutes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, month) DO UPDATE SET
         inbound_minutes = usage_counters.inbound_minutes + EXCLUDED.inbound_minutes,
         outbound_minutes = usage_counters.outbound_minutes + EXCLUDED.outbound_minutes`,
      [clientId, month, inboundMin, outboundMin],
    );
    return (await this.getUsage(clientId, month))!;
  }
  async getUsage(clientId: string, month: string) {
    const r = await this.pool.query("SELECT * FROM usage_counters WHERE client_id = $1 AND month = $2", [
      clientId,
      month,
    ]);
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      clientId: row.client_id,
      month: row.month,
      inboundMinutes: row.inbound_minutes,
      outboundMinutes: row.outbound_minutes,
    } as UsageCounters;
  }
  async saveKnowledgeDocument(document: KnowledgeDocument) {
    await this.pool.query(
      `INSERT INTO knowledge_documents
       (id, client_id, title, source_type, source_uri, mime_type, checksum, status, metadata, error, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, source_type = EXCLUDED.source_type, source_uri = EXCLUDED.source_uri,
         mime_type = EXCLUDED.mime_type, checksum = EXCLUDED.checksum, status = EXCLUDED.status,
         metadata = EXCLUDED.metadata, error = EXCLUDED.error, updated_at = EXCLUDED.updated_at
       WHERE knowledge_documents.client_id = EXCLUDED.client_id`,
      [
        document.id, document.clientId, document.title, document.sourceType,
        document.sourceUri ?? null, document.mimeType ?? null, document.checksum ?? null,
        document.status, document.metadata ?? {}, document.error ?? null,
        document.createdAt, document.updatedAt,
      ],
    );
  }
  async getKnowledgeDocument(clientId: string, id: string) {
    const r = await this.pool.query(
      "SELECT * FROM knowledge_documents WHERE client_id = $1 AND id = $2",
      [clientId, id],
    );
    return r.rows[0] ? knowledgeDocumentFromRow(r.rows[0]) : undefined;
  }
  async listKnowledgeDocuments(clientId: string, options: KnowledgeDocumentListOptions = {}) {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const values: unknown[] = [clientId];
    const where = ["client_id = $1"];
    if (options.status) {
      values.push(options.status);
      where.push(`status = $${values.length}`);
    }
    if (options.cursor) {
      const separator = options.cursor.lastIndexOf("|");
      values.push(
        separator > 0 ? options.cursor.slice(0, separator) : options.cursor,
        separator > 0 ? options.cursor.slice(separator + 1) : "",
      );
      where.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }
    values.push(limit + 1);
    const r = await this.pool.query(
      `SELECT * FROM knowledge_documents WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    );
    const items = r.rows.slice(0, limit).map(knowledgeDocumentFromRow);
    const last = r.rows[Math.min(limit, r.rows.length) - 1];
    return {
      items,
      nextCursor: r.rows.length > limit && last ? `${toIso(last.created_at)}|${last.id}` : undefined,
    };
  }
  async deleteKnowledgeDocument(clientId: string, id: string) {
    const r = await this.pool.query(
      "DELETE FROM knowledge_documents WHERE client_id = $1 AND id = $2",
      [clientId, id],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async replaceKnowledgeChunks(clientId: string, documentId: string, chunks: KnowledgeChunk[]) {
    if (chunks.some((chunk) => chunk.clientId !== clientId || chunk.documentId !== documentId)) {
      throw new Error("tenant_mismatch");
    }
    if (chunks.some((chunk) => chunk.embedding.length !== 768)) {
      throw new Error("embedding_must_have_768_dimensions");
    }
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        "DELETE FROM knowledge_chunks WHERE client_id = $1 AND document_id = $2",
        [clientId, documentId],
      );
      for (const chunk of chunks) {
        await connection.query(
          `INSERT INTO knowledge_chunks
           (id, client_id, document_id, chunk_index, content, token_count, embedding, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8,$9)`,
          [
            chunk.id, clientId, documentId, chunk.chunkIndex, chunk.content, chunk.tokenCount,
            vectorLiteral(chunk.embedding), chunk.metadata ?? {}, chunk.createdAt,
          ],
        );
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }
  async searchKnowledge(clientId: string, embedding: number[], options: KnowledgeSearchOptions = {}) {
    if (embedding.length !== 768) throw new Error("embedding_must_have_768_dimensions");
    const limit = Math.max(1, Math.min(options.limit ?? 5, 20));
    const values: unknown[] = [clientId, vectorLiteral(embedding)];
    const where = ["c.client_id = $1"];
    if (options.documentIds?.length) {
      values.push(options.documentIds);
      where.push(`c.document_id = ANY($${values.length}::text[])`);
    }
    if (options.minScore !== undefined) {
      values.push(options.minScore);
      where.push(`1 - (c.embedding <=> $2::vector) >= $${values.length}`);
    }
    values.push(limit);
    const r = await this.pool.query(
      `SELECT c.*, 1 - (c.embedding <=> $2::vector) AS score,
              d.title AS document_title, d.source_type AS document_source_type,
              d.source_uri AS document_source_uri, d.mime_type AS document_mime_type,
              d.checksum AS document_checksum, d.status AS document_status,
              d.metadata AS document_metadata, d.error AS document_error,
              d.created_at AS document_created_at, d.updated_at AS document_updated_at
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id AND d.client_id = c.client_id
       WHERE ${where.join(" AND ")}
       ORDER BY c.embedding <=> $2::vector LIMIT $${values.length}`,
      values,
    );
    return r.rows.map((row) => ({
      chunk: knowledgeChunkFromRow(row),
      document: knowledgeDocumentFromRow({
        id: row.document_id,
        client_id: row.client_id,
        title: row.document_title,
        source_type: row.document_source_type,
        source_uri: row.document_source_uri,
        mime_type: row.document_mime_type,
        checksum: row.document_checksum,
        status: row.document_status,
        metadata: row.document_metadata,
        error: row.document_error,
        created_at: row.document_created_at,
        updated_at: row.document_updated_at,
      }),
      score: Number(row.score),
    }));
  }
  async deleteCallsOlderThan(isoDate: string) {
    const r = await this.pool.query("DELETE FROM call_sessions WHERE created_at < $1", [isoDate]);
    return r.rowCount ?? 0;
  }

  private async analyticsCalls(clientId: string, range: AnalyticsRange) {
    const r = await this.pool.query(
      `SELECT payload FROM call_sessions
       WHERE client_id = $1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz`,
      [clientId, range.from, range.to],
    );
    return r.rows.map((row) => row.payload as CallSession);
  }
}

function toIso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function promptFromRow(row: Record<string, any>): PromptVersion {
  return {
    id: row.id,
    clientId: row.client_id,
    version: row.version,
    compiled: row.compiled,
    createdAt: toIso(row.created_at),
  };
}

function clientRevisionFromRow(row: Record<string, any>): ClientConfigRevision {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    config: row.config,
    createdBy: row.created_by ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    publishedAt: row.published_at ? toIso(row.published_at) : undefined,
  };
}

function membershipFromRow(row: Record<string, any>): WorkspaceMembership {
  return {
    id: row.id,
    clientId: row.client_id,
    email: row.email,
    role: row.role,
    createdAt: toIso(row.created_at),
  };
}

function userProfileFromRow(row: Record<string, any>): UserProfile {
  return {
    id: row.id, clientId: row.client_id ?? undefined, authUserId: row.auth_user_id, email: row.email,
    displayName: row.display_name ?? undefined, platformRole: row.platform_role,
    workspaceRole: row.workspace_role ?? undefined,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function locationFromRow(row: Record<string, any>): Location {
  return {
    id: row.id, clientId: row.client_id, slug: row.slug, name: row.name, timezone: row.timezone,
    phone: row.phone ?? undefined, address: row.address ?? {}, isPrimary: row.is_primary,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function agentInstanceFromRow(row: Record<string, any>): AgentInstance {
  return {
    id: row.id, clientId: row.client_id, locationId: row.location_id ?? undefined,
    provider: row.provider, providerAgentId: row.provider_agent_id ?? undefined,
    voiceCredentialHash: row.voice_credential_hash ?? undefined,
    providerSecretId: row.provider_secret_id ?? undefined,
    name: row.name, status: row.status, config: row.config ?? {},
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function phoneEndpointFromRow(row: Record<string, any>): PhoneEndpoint {
  return {
    id: row.id, clientId: row.client_id, locationId: row.location_id ?? undefined,
    agentInstanceId: row.agent_instance_id ?? undefined, provider: row.provider, e164: row.e164,
    providerEndpointId: row.provider_endpoint_id ?? undefined, direction: row.direction, status: row.status,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function twilioConnectionFromRow(row: Record<string, any>): TwilioConnection {
  return {
    id: row.id,
    clientId: row.client_id,
    mode: row.mode,
    accountSid: row.account_sid ?? undefined,
    encryptedAccessToken: row.encrypted_access_token ?? undefined,
    encryptedRefreshToken: row.encrypted_refresh_token ?? undefined,
    accessTokenExpiresAt: row.access_token_expires_at ? toIso(row.access_token_expires_at) : undefined,
    apiKeySid: row.api_key_sid ?? undefined,
    encryptedApiKeySecret: row.encrypted_api_key_secret ?? undefined,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function calendarConnectionFromRow(row: Record<string, any>): CalendarConnection {
  return {
    id: row.id, clientId: row.client_id, locationId: row.location_id ?? undefined,
    provider: row.provider, externalAccountId: row.external_account_id ?? undefined,
    credentialRef: row.credential_ref, calendarId: row.calendar_id ?? undefined,
    status: row.status, metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function calendarEventTypeFromRow(row: Record<string, any>): CalendarEventType {
  return {
    id: row.id,
    clientId: row.client_id,
    calendarConnectionId: row.calendar_connection_id,
    serviceSlug: row.service_slug,
    providerEventTypeId: row.provider_event_type_id,
    providerSlug: row.provider_slug,
    title: row.title,
    durationMinutes: Number(row.duration_minutes),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function subscriptionFromRow(row: Record<string, any>): Subscription {
  return {
    id: row.id, clientId: row.client_id, provider: row.provider,
    providerCustomerId: row.provider_customer_id ?? undefined,
    providerSubscriptionId: row.provider_subscription_id ?? undefined,
    planTier: row.plan_tier, status: row.status, priceId: row.price_id ?? undefined,
    trialEndsAt: row.trial_ends_at ? toIso(row.trial_ends_at) : undefined,
    currentPeriodStart: row.current_period_start ? toIso(row.current_period_start) : undefined,
    currentPeriodEnd: row.current_period_end ? toIso(row.current_period_end) : undefined,
    cancelAtPeriodEnd: row.cancel_at_period_end, metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function stripeEventFromRow(row: Record<string, any>): StripeEvent {
  return {
    id: row.id, clientId: row.client_id ?? undefined, eventType: row.event_type, livemode: row.livemode,
    payload: row.payload, status: row.status, error: row.error ?? undefined,
    receivedAt: toIso(row.received_at),
    processedAt: row.processed_at ? toIso(row.processed_at) : undefined,
  };
}

function bookingRecordFromRow(row: Record<string, any>): BookingRecord {
  return {
    id: row.id, clientId: row.client_id, locationId: row.location_id ?? undefined,
    calendarConnectionId: row.calendar_connection_id ?? undefined, callId: row.call_id ?? undefined,
    provider: row.provider, providerBookingId: row.provider_booking_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined, status: row.status,
    startsAt: toIso(row.starts_at), endsAt: toIso(row.ends_at),
    attendeeName: row.attendee_name ?? undefined, attendeePhone: row.attendee_phone ?? undefined,
    attendeeEmail: row.attendee_email ?? undefined, serviceSlug: row.service_slug ?? undefined,
    metadata: row.metadata ?? {}, createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function creditLedgerEntryFromRow(row: Record<string, any>): CreditLedgerEntry {
  return {
    id: row.id, clientId: row.client_id, minutes: Number(row.minutes),
    kind: row.kind, direction: row.direction ?? undefined,
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined, description: row.description ?? undefined,
    createdAt: toIso(row.created_at),
  };
}

function operatorAuditFromRow(row: Record<string, any>): OperatorAuditRecord {
  return {
    id: row.id,
    clientId: row.client_id ?? undefined,
    actorId: row.actor_id,
    action: row.action,
    detail: row.detail ?? {},
    createdAt: toIso(row.created_at),
  };
}

function provisioningRunFromRow(row: Record<string, any>): ProvisioningRun {
  return {
    id: row.id, clientId: row.client_id, idempotencyKey: row.idempotency_key,
    status: row.status, step: row.step ?? undefined, input: row.input ?? {},
    output: row.output ?? undefined, error: row.error ?? undefined,
    startedAt: row.started_at ? toIso(row.started_at) : undefined,
    finishedAt: row.finished_at ? toIso(row.finished_at) : undefined,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function knowledgeDocumentFromRow(row: Record<string, any>): KnowledgeDocument {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    sourceType: row.source_type,
    sourceUri: row.source_uri ?? undefined,
    mimeType: row.mime_type ?? undefined,
    checksum: row.checksum ?? undefined,
    status: row.status,
    metadata: row.metadata ?? {},
    error: row.error ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function knowledgeChunkFromRow(row: Record<string, any>): KnowledgeChunk {
  const embedding = Array.isArray(row.embedding)
    ? row.embedding.map(Number)
    : String(row.embedding).replace(/^\[|\]$/g, "").split(",").filter(Boolean).map(Number);
  return {
    id: row.id,
    clientId: row.client_id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tokenCount: row.token_count,
    embedding,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at),
  };
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

function durationMinutes(call: CallSession) {
  const value = call.collected.durationMinutes;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function analyticsSummary(clientId: string, range: AnalyticsRange, calls: CallSession[]): AnalyticsSummary {
  return {
    clientId,
    ...range,
    totalCalls: calls.length,
    inboundCalls: calls.filter((call) => call.direction === "inbound").length,
    outboundCalls: calls.filter((call) => call.direction === "outbound").length,
    completedCalls: calls.filter((call) => call.status === "completed").length,
    transferredCalls: calls.filter((call) => call.status === "transferred").length,
    failedCalls: calls.filter((call) => call.status === "failed").length,
    bookedCalls: calls.filter((call) => Boolean(call.appointmentId)).length,
    totalMinutes: calls.reduce((sum, call) => sum + durationMinutes(call), 0),
  };
}

function analyticsTimeseries(calls: CallSession[]): AnalyticsTimeseriesPoint[] {
  const points = new Map<string, AnalyticsTimeseriesPoint>();
  for (const call of calls) {
    const date = call.createdAt.slice(0, 10);
    const point = points.get(date) ?? { date, calls: 0, completed: 0, transferred: 0, failed: 0, booked: 0 };
    point.calls++;
    if (call.status === "completed") point.completed++;
    if (call.status === "transferred") point.transferred++;
    if (call.status === "failed") point.failed++;
    if (call.appointmentId) point.booked++;
    points.set(date, point);
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function createPool(databaseUrl: string) {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 8_000,
    ssl: poolSsl(databaseUrl),
  });
}

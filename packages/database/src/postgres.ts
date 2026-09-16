import { poolSsl } from "./env.js";
import pg from "pg";
import { sortClientsForDashboard } from "./clientOrder.js";
import { assertOnboardingTransition } from "./lifecycle.js";
import type { BillingTransition, PlatformStore } from "./memory.js";
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
  ExtractedFact,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentListOptions,
  KnowledgeSearchOptions,
  Location,
  OperatorAuditRecord,
  OnboardingGap,
  OnboardingJob,
  OnboardingOutboxEvent,
  OnboardingWizardState,
  NotificationDelivery,
  OutboundJob,
  Page,
  PhoneEndpoint,
  PromptVersion,
  ProvisioningActivationInput,
  ProvisioningActivationIntent,
  ProvisioningActivationResult,
  ProvisioningRun,
  ProviderResource,
  StripeEvent,
  Subscription,
  Suppression,
  TenantRequest,
  ToolActionRow,
  TwilioConnection,
  UsageCounters,
  UserProfile,
  WebsiteExtractionRun,
  WebsiteSource,
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
       (id, client_id, auth_user_id, email, display_name, platform_role, workspace_role,
        terms_accepted_at, privacy_accepted_at, created_at, updated_at)
       VALUES ($1,$2,$3,lower($4),$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, auth_user_id = EXCLUDED.auth_user_id,
         email = EXCLUDED.email, display_name = EXCLUDED.display_name,
         platform_role = EXCLUDED.platform_role, workspace_role = EXCLUDED.workspace_role,
         terms_accepted_at = COALESCE(EXCLUDED.terms_accepted_at, user_profiles.terms_accepted_at),
         privacy_accepted_at = COALESCE(EXCLUDED.privacy_accepted_at, user_profiles.privacy_accepted_at),
         updated_at = EXCLUDED.updated_at`,
      [profile.id, profile.clientId ?? null, profile.authUserId, profile.email.trim(),
        profile.displayName ?? null, profile.platformRole, profile.workspaceRole ?? null,
        profile.termsAcceptedAt ?? null, profile.privacyAcceptedAt ?? null,
        profile.createdAt, profile.updatedAt],
    );
  }
  async saveTenantRequest(request: TenantRequest) {
    const result = await this.pool.query(
      `INSERT INTO tenant_requests
       (id, client_id, type, status, requested_by, email, payload, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,lower($6),$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, email = EXCLUDED.email,
         payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
       WHERE tenant_requests.client_id = EXCLUDED.client_id
       RETURNING id`,
      [request.id, request.clientId, request.type, request.status, request.requestedBy,
        request.email ?? null, request.payload, request.createdAt, request.updatedAt],
    );
    if (result.rowCount !== 1) throw new Error("tenant_request_conflict");
  }
  async listTenantRequests(clientId?: string, type?: TenantRequest["type"]) {
    const values: unknown[] = [];
    const filters: string[] = [];
    if (clientId) { values.push(clientId); filters.push(`client_id = $${values.length}`); }
    if (type) { values.push(type); filters.push(`type = $${values.length}`); }
    const result = await this.pool.query(
      `SELECT * FROM tenant_requests ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY created_at DESC LIMIT 500`,
      values,
    );
    return result.rows.map(tenantRequestFromRow);
  }
  async getTenantRequest(id: string) {
    const result = await this.pool.query("SELECT * FROM tenant_requests WHERE id = $1", [id]);
    return result.rows[0] ? tenantRequestFromRow(result.rows[0]) : undefined;
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
  async findPhoneEndpointByE164(e164: string) {
    const r = await this.pool.query("SELECT * FROM phone_endpoints WHERE e164 = $1", [e164]);
    return r.rows[0] ? phoneEndpointFromRow(r.rows[0]) : undefined;
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
        access_token_expires_at, api_key_sid, encrypted_api_key_secret, encrypted_account_auth_token,
        selected_phone_number, regulatory_bundle_sid, emergency_address_sid,
        monthly_spend_cap_pence, purchase_confirmed_by, purchase_confirmed_at,
        status, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (client_id) DO UPDATE SET
         mode = EXCLUDED.mode, account_sid = EXCLUDED.account_sid,
         encrypted_access_token = EXCLUDED.encrypted_access_token,
         encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         api_key_sid = EXCLUDED.api_key_sid,
         encrypted_api_key_secret = EXCLUDED.encrypted_api_key_secret,
         encrypted_account_auth_token = EXCLUDED.encrypted_account_auth_token,
         selected_phone_number = EXCLUDED.selected_phone_number,
         regulatory_bundle_sid = EXCLUDED.regulatory_bundle_sid,
         emergency_address_sid = EXCLUDED.emergency_address_sid,
         monthly_spend_cap_pence = EXCLUDED.monthly_spend_cap_pence,
         purchase_confirmed_by = EXCLUDED.purchase_confirmed_by,
         purchase_confirmed_at = EXCLUDED.purchase_confirmed_at,
         status = EXCLUDED.status, metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [connection.id, connection.clientId, connection.mode, connection.accountSid ?? null,
        connection.encryptedAccessToken ?? null, connection.encryptedRefreshToken ?? null,
        connection.accessTokenExpiresAt ?? null, connection.apiKeySid ?? null,
        connection.encryptedApiKeySecret ?? null, connection.encryptedAccountAuthToken ?? null,
        connection.selectedPhoneNumber ?? null,
        connection.regulatoryBundleSid ?? null, connection.emergencyAddressSid ?? null,
        connection.monthlySpendCapPence ?? null, connection.purchaseConfirmedBy ?? null,
        connection.purchaseConfirmedAt ?? null, connection.status, connection.metadata,
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
        status, metadata, created_at, updated_at, connection_mode, encrypted_access_token,
        encrypted_refresh_token, access_token_expires_at, scopes, destination_provider)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET location_id = EXCLUDED.location_id, provider = EXCLUDED.provider,
         external_account_id = EXCLUDED.external_account_id, credential_ref = EXCLUDED.credential_ref,
         calendar_id = EXCLUDED.calendar_id, status = EXCLUDED.status, metadata = EXCLUDED.metadata,
         connection_mode = EXCLUDED.connection_mode,
         encrypted_access_token = EXCLUDED.encrypted_access_token,
         encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         scopes = EXCLUDED.scopes, destination_provider = EXCLUDED.destination_provider,
         updated_at = EXCLUDED.updated_at
       WHERE calendar_connections.client_id = EXCLUDED.client_id`,
      [connection.id, connection.clientId, connection.locationId ?? null, connection.provider,
        connection.externalAccountId ?? null, connection.credentialRef, connection.calendarId ?? null,
        connection.status, connection.metadata, connection.createdAt, connection.updatedAt,
        connection.mode ?? null, connection.encryptedAccessToken ?? null,
        connection.encryptedRefreshToken ?? null, connection.accessTokenExpiresAt ?? null,
        connection.scopes ?? [], connection.destinationProvider ?? null],
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
        provider_slug, title, duration_minutes, status, created_at, updated_at, readiness_only)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (client_id, service_slug) DO UPDATE SET
         calendar_connection_id = EXCLUDED.calendar_connection_id,
         provider_event_type_id = EXCLUDED.provider_event_type_id,
         provider_slug = EXCLUDED.provider_slug, title = EXCLUDED.title,
         duration_minutes = EXCLUDED.duration_minutes, status = EXCLUDED.status,
         readiness_only = EXCLUDED.readiness_only,
         updated_at = EXCLUDED.updated_at`,
      [eventType.id, eventType.clientId, eventType.calendarConnectionId, eventType.serviceSlug,
        eventType.providerEventTypeId, eventType.providerSlug, eventType.title,
        eventType.durationMinutes, eventType.status, eventType.createdAt, eventType.updatedAt,
        eventType.readinessOnly ?? false],
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
  async applyBillingTransition(transition: BillingTransition) {
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      const transactional = new PostgresStore(connection as unknown as pg.Pool);
      await transactional.upsertClient(transition.client);
      await transactional.upsertSubscription(transition.subscription);
      if (transition.credit) await transactional.appendCreditLedgerEntry(transition.credit);
      await transactional.appendOperatorAudit(transition.audit);
      await transactional.saveStripeEvent(transition.event);
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
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
  async claimProvisioningRun(run: ProvisioningRun, claimToken = run.claimToken || "", staleAfterSeconds = 1800) {
    const r = await this.pool.query(
      `INSERT INTO provisioning_runs
       (id, client_id, idempotency_key, status, step, input, output, error, started_at,
        finished_at, created_at, updated_at, claim_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (client_id, idempotency_key) DO UPDATE SET
         status='running', error=NULL, finished_at=NULL,
         started_at=COALESCE(provisioning_runs.started_at, EXCLUDED.started_at, EXCLUDED.updated_at),
         updated_at=EXCLUDED.updated_at, claim_token=EXCLUDED.claim_token
       WHERE provisioning_runs.status IN ('pending','failed')
          OR (provisioning_runs.status='running'
              AND provisioning_runs.updated_at <= EXCLUDED.updated_at - ($14::int * interval '1 second'))
       RETURNING id, output, started_at`,
      [run.id, run.clientId, run.idempotencyKey, run.status, run.step ?? null, run.input,
        run.output ?? null, run.error ?? null, run.startedAt ?? null, run.finishedAt ?? null,
        run.createdAt, run.updatedAt, claimToken, Math.max(1, staleAfterSeconds)],
    );
    if (r.rows[0]) {
      run.id = r.rows[0].id;
      run.output = r.rows[0].output ?? run.output;
      run.startedAt = r.rows[0].started_at ? toIso(r.rows[0].started_at) : run.startedAt;
      run.claimToken = claimToken;
    }
    return r.rowCount === 1;
  }
  async renewProvisioningRunClaim(clientId: string, runId: string, claimToken: string, now: string) {
    const result = await this.pool.query(
      `UPDATE provisioning_runs SET updated_at=$4
       WHERE client_id=$1 AND id=$2 AND status='running' AND claim_token=$3
       RETURNING id`,
      [clientId, runId, claimToken, now],
    );
    return result.rowCount === 1;
  }
  async saveProvisioningRun(run: ProvisioningRun, claimToken?: string) {
    const result = await this.pool.query(
      `INSERT INTO provisioning_runs
       (id, client_id, idempotency_key, status, step, input, output, error, started_at,
        finished_at, created_at, updated_at, claim_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, step = EXCLUDED.step,
         output = EXCLUDED.output, error = EXCLUDED.error, started_at = EXCLUDED.started_at,
         finished_at = EXCLUDED.finished_at, updated_at = EXCLUDED.updated_at,
         claim_token = EXCLUDED.claim_token
       WHERE provisioning_runs.client_id = EXCLUDED.client_id
         AND ($14::text IS NULL OR provisioning_runs.claim_token = $14)
       RETURNING id`,
      [run.id, run.clientId, run.idempotencyKey, run.status, run.step ?? null, run.input,
        run.output ?? null, run.error ?? null, run.startedAt ?? null, run.finishedAt ?? null,
        run.createdAt, run.updatedAt, run.claimToken ?? null, claimToken ?? null],
    );
    return result.rowCount === 1;
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
  async prepareProvisionedClientActivation(input: ProvisioningActivationInput): Promise<ProvisioningActivationResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      const owner = await connection.query(
        `SELECT id FROM workspace_memberships
         WHERE client_id=$1 AND email=lower($2) AND role='owner' FOR UPDATE`,
        [input.clientId, input.actorEmail],
      );
      if (owner.rowCount !== 1) {
        await connection.query("ROLLBACK");
        return { activated: false, error: "workspace_owner_required" };
      }
      const rows = await connection.query(
        `SELECT c.config,
          (SELECT status FROM subscriptions WHERE client_id=$1 ORDER BY updated_at DESC LIMIT 1) billing_status,
          (SELECT count(*) FROM onboarding_gaps WHERE client_id=$1 AND status='open') open_gaps,
          (SELECT count(*) FROM twilio_connections WHERE client_id=$1 AND status='active') active_twilio,
          (SELECT mode FROM twilio_connections WHERE client_id=$1) twilio_mode,
          (SELECT encrypted_account_auth_token IS NOT NULL FROM twilio_connections WHERE client_id=$1)
            has_account_auth_token,
          (SELECT count(*) FROM calendar_connections WHERE client_id=$1 AND status='active') active_calendar,
          jsonb_build_object('id',p.id,'status',p.status,'step',p.step,'output',p.output) run,
          (SELECT pe.id FROM phone_endpoints pe
             WHERE pe.client_id=$1 AND pe.e164=p.output->>'phoneNumber'
               AND pe.direction<>'outbound' ORDER BY pe.created_at DESC LIMIT 1) phone_endpoint_id,
          (SELECT jsonb_build_object('id',r.id,'config',r.config,'created_by',r.created_by,
             'created_at',r.created_at,'updated_at',r.updated_at)
             FROM client_config_revisions r WHERE r.client_id=$1 AND r.status='draft'
             ORDER BY r.updated_at DESC LIMIT 1) draft,
          (SELECT count(*) FROM onboarding_wizard_states w
             JOIN website_extraction_runs x ON x.client_id=w.client_id AND x.id=w.data->>'websiteRunId'
             JOIN website_sources s ON s.client_id=x.client_id AND s.id=x.source_id
             WHERE w.client_id=$1 AND w.submitted_at IS NOT NULL
               AND s.metadata->>'approvedRunId'=x.id
               AND EXISTS (SELECT 1 FROM extracted_facts f WHERE f.client_id=$1 AND f.extraction_run_id=x.id)
               AND NOT EXISTS (SELECT 1 FROM extracted_facts f WHERE f.client_id=$1
                 AND f.extraction_run_id=x.id AND f.review_status='extracted')) confirmed_facts
         FROM clients c
         JOIN provisioning_runs p ON p.client_id=c.id AND p.id=$2
         WHERE c.id=$1 FOR UPDATE OF c,p`,
        [input.clientId, input.runId],
      );
      if (!rows.rows[0]) {
        await connection.query("ROLLBACK");
        return { activated: false, error: "client_not_found" };
      }
      const row = rows.rows[0];
      const run = row.run as { id?: string; status?: string; step?: string; output?: Record<string, unknown> } | null;
      const client = row.config as ClientConfig;
      const prior = await connection.query(
        "SELECT 1 FROM operator_audit_log WHERE client_id=$1 AND id=$2",
        [input.clientId, `activation_${input.runId}`],
      );
      if (client.onboardingStatus === "active" && prior.rowCount === 1) {
        await connection.query("COMMIT");
        return { activated: true, client };
      }
      const blockers: string[] = [];
      if (!["active", "trialing"].includes(String(row.billing_status || ""))) blockers.push("billing_inactive");
      if (Number(row.confirmed_facts) !== 1) blockers.push("required_facts_unconfirmed");
      if (Number(row.open_gaps) > 0) blockers.push("hard_gaps_open");
      if (Number(row.active_twilio) < 1) blockers.push("twilio_inactive");
      if (
        run?.output?.phoneNumber &&
        row.twilio_mode === "customer_oauth" &&
        row.has_account_auth_token !== true
      ) blockers.push("twilio_account_auth_token_missing");
      if (Number(row.active_calendar) < 1) blockers.push("calendar_inactive");
      const existingIntent = run?.output?.activationIntent as ProvisioningActivationIntent | undefined;
      const resumableActivation = Boolean(
        existingIntent && ["activation_pending", "activating", "paused"].includes(run?.status || ""),
      );
      if (!resumableActivation && (run?.status !== "succeeded" || run.step !== "awaiting_approval")) {
        blockers.push("provisioning_incomplete");
      }
      if ((run?.output?.readinessReport as { passed?: boolean } | undefined)?.passed !== true) {
        blockers.push("synthetic_tests_failed");
      }
      if (run?.output?.profileChecksum !== input.profileChecksum ||
          run?.output?.compiledPrompt !== input.prompt.compiled) {
        blockers.push("provisioning_profile_changed");
      }
      if (!["awaiting_approval", "needs_attention"].includes(client.onboardingStatus || "")) {
        blockers.push("not_awaiting_approval");
      }
      if (existingIntent?.rollbackStatus === "failed") blockers.push("provider_rollback_incomplete");
      if (blockers.length) {
        await connection.query("ROLLBACK");
        return { activated: false, error: "activation_requirements_not_met", blockers };
      }
      const providerAgentId = String(run?.output?.elevenlabsAgentId || "");
      const phoneNumber = String(run?.output?.phoneNumber || "") || undefined;
      if (!providerAgentId) {
        await connection.query("ROLLBACK");
        return { activated: false, error: "activation_requirements_not_met", blockers: ["provider_agent_missing"] };
      }
      if (client.onboardingStatus === "needs_attention") {
        assertOnboardingTransition("needs_attention", "awaiting_approval");
        client.onboardingStatus = "awaiting_approval";
        await connection.query("UPDATE clients SET config=$2 WHERE id=$1", [input.clientId, client]);
      }
      if (existingIntent?.rollbackStatus === "deleted") {
        existingIntent.providerPhoneNumberId = undefined;
        existingIntent.assignmentStatus = existingIntent.phoneNumber ? "pending" : "assigned";
        existingIntent.rollbackStatus = undefined;
        existingIntent.rollbackError = undefined;
      }
      const intent: ProvisioningActivationIntent = existingIntent || {
        promptId: input.prompt.id,
        promptVersion: input.prompt.version,
        profileChecksum: input.profileChecksum,
        operationKey: `activate:${input.runId}`,
        providerAgentId,
        phoneNumber,
        phoneEndpointId: row.phone_endpoint_id ?? undefined,
        assignmentStatus: phoneNumber ? "pending" : "assigned",
      };
      await connection.query(
        `UPDATE provisioning_runs
         SET status='activation_pending',step='activation_pending',error=NULL,
             output=jsonb_set(COALESCE(output,'{}'::jsonb),'{activationIntent}',$3::jsonb),
             updated_at=$4
         WHERE client_id=$1 AND id=$2`,
        [input.clientId, input.runId, intent, input.now],
      );
      await connection.query("COMMIT");
      return { activated: false, client, intent };
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }
  async recordProvisioningActivationProgress(
    clientId: string,
    runId: string,
    assignmentStatus: "imported" | "assigned",
    providerPhoneNumberId: string,
    now: string,
  ): Promise<ProvisioningActivationResult> {
    const result = await this.pool.query(
      `UPDATE provisioning_runs
       SET status='activating',
           step=CASE WHEN $3='assigned' THEN 'provider_assignment_confirmed' ELSE 'provider_phone_imported' END,
           output=jsonb_set(
             jsonb_set(output,'{activationIntent,providerPhoneNumberId}',to_jsonb($4::text),true),
             '{activationIntent,assignmentStatus}',to_jsonb($3::text),true
           ),
           updated_at=$5
       WHERE client_id=$1 AND id=$2 AND status IN ('activation_pending','activating')
         AND output->'activationIntent' IS NOT NULL
       RETURNING output->'activationIntent' AS intent`,
      [clientId, runId, assignmentStatus, providerPhoneNumberId, now],
    );
    if (result.rowCount !== 1) return { activated: false, error: "activation_intent_missing" };
    return { activated: false, intent: result.rows[0].intent as ProvisioningActivationIntent };
  }
  async finalizeProvisionedClientActivation(input: ProvisioningActivationInput): Promise<ProvisioningActivationResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      const rowResult = await connection.query(
        `SELECT c.config,p.status,p.output,
          (SELECT jsonb_build_object('id',r.id,'config',r.config)
           FROM client_config_revisions r WHERE r.client_id=$1 AND r.status='draft'
           ORDER BY r.updated_at DESC LIMIT 1) draft,
          EXISTS(SELECT 1 FROM workspace_memberships
            WHERE client_id=$1 AND email=lower($3) AND role='owner') owner
         FROM clients c JOIN provisioning_runs p ON p.client_id=c.id AND p.id=$2
         WHERE c.id=$1 FOR UPDATE OF c,p`,
        [input.clientId, input.runId, input.actorEmail],
      );
      const row = rowResult.rows[0];
      if (!row) {
        await connection.query("ROLLBACK");
        return { activated: false, error: "client_not_found" };
      }
      const client = row.config as ClientConfig;
      const intent = row.output?.activationIntent as ProvisioningActivationIntent | undefined;
      if (client.onboardingStatus === "active") {
        const prior = await connection.query(
          "SELECT 1 FROM operator_audit_log WHERE client_id=$1 AND id=$2",
          [input.clientId, `activation_${input.runId}`],
        );
        if (prior.rowCount === 1) {
          await connection.query("COMMIT");
          return { activated: true, client, intent };
        }
      }
      if (!row.owner) {
        await connection.query("ROLLBACK");
        return { activated: false, error: "workspace_owner_required" };
      }
      if (
        !["activation_pending", "activating"].includes(row.status) ||
        intent?.assignmentStatus !== "assigned" ||
        intent.profileChecksum !== input.profileChecksum ||
        row.output?.compiledPrompt !== input.prompt.compiled
      ) {
        await connection.query("ROLLBACK");
        return { activated: false, error: "activation_finalize_requirements_not_met" };
      }
      assertOnboardingTransition(client.onboardingStatus, "active");
      const draft = row.draft as { id: string; config: ClientConfig } | null;
      const activated: ClientConfig = {
        ...(draft?.config || client),
        elevenlabsAgentId: client.elevenlabsAgentId,
        inboundNumbers: client.inboundNumbers,
        published: true,
        onboardingStatus: "active",
        promptVersionId: intent.promptId,
      };
      await connection.query(
        `INSERT INTO prompt_versions(id,client_id,version,compiled) VALUES ($1,$2,$3,$4)
         ON CONFLICT(id) DO NOTHING`,
        [intent.promptId, input.clientId, intent.promptVersion, input.prompt.compiled],
      );
      await connection.query("UPDATE clients SET slug=$2,config=$3 WHERE id=$1", [
        input.clientId, activated.slug, activated,
      ]);
      if (draft) {
        await connection.query(
          `UPDATE client_config_revisions
           SET status=CASE WHEN id=$2 THEN 'published' ELSE 'superseded' END,
               published_at=CASE WHEN id=$2 THEN $3 ELSE published_at END,updated_at=$3
           WHERE client_id=$1 AND status='draft'`,
          [input.clientId, draft.id, input.now],
        );
      }
      await connection.query(
        `UPDATE agent_instances SET status='active',updated_at=$2
         WHERE client_id=$1 AND provider_agent_id=$3`,
        [input.clientId, input.now, intent.providerAgentId],
      );
      await connection.query(
        `UPDATE phone_endpoints SET status='active',provider_endpoint_id=$3,updated_at=$2,
           metadata=metadata || jsonb_build_object('assignmentStatus','active','activatedRunId',$4::text)
         WHERE client_id=$1 AND id=$5`,
        [input.clientId, input.now, intent.providerPhoneNumberId ?? null, input.runId,
          intent.phoneEndpointId ?? null],
      );
      await connection.query(
        `INSERT INTO operator_audit_log(id,client_id,actor_id,action,detail,created_at)
         VALUES ($1,$2,$3,'provisioning.owner_activated',$4,$5) ON CONFLICT DO NOTHING`,
        [`activation_${input.runId}`, input.clientId, input.actorId,
          { runId: input.runId, promptVersionId: intent.promptId }, input.now],
      );
      await connection.query(
        `UPDATE provisioning_runs SET status='succeeded',step='active',error=NULL,
           finished_at=$3,updated_at=$3 WHERE client_id=$1 AND id=$2`,
        [input.clientId, input.runId, input.now],
      );
      await connection.query("COMMIT");
      return { activated: true, client: activated, intent };
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }
  async failProvisionedClientActivation(
    clientId: string,
    runId: string,
    error: string,
    now: string,
    rollback?: { status: "deleted" | "failed"; error?: string },
  ) {
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        `UPDATE provisioning_runs SET status='paused',step='activation_needs_attention',
           error=$3,
           output=jsonb_set(
             jsonb_set(
               jsonb_set(output,'{activationIntent,assignmentStatus}','"needs_attention"'::jsonb,true),
               '{activationIntent,rollbackStatus}',COALESCE(to_jsonb($5::text),'null'::jsonb),true
             ),
             '{activationIntent,rollbackError}',COALESCE(to_jsonb($6::text),'null'::jsonb),true
           ),
           updated_at=$4
         WHERE client_id=$1 AND id=$2 AND output->'activationIntent' IS NOT NULL`,
        [clientId, runId, error.slice(0, 500), now, rollback?.status ?? null,
          rollback?.error?.slice(0, 300) ?? null],
      );
      await connection.query(
        `UPDATE clients SET config=jsonb_set(config,'{onboardingStatus}','"needs_attention"'::jsonb)
         WHERE id=$1 AND config->>'onboardingStatus'<>'active'`,
        [clientId],
      );
      await connection.query(
        `UPDATE phone_endpoints SET status='pending',updated_at=$2,
           metadata=metadata || jsonb_build_object(
             'assignmentStatus','needs_attention','activationError',$3::text,
             'rollbackStatus',$4::text)
         WHERE client_id=$1 AND id=(
           SELECT output->'activationIntent'->>'phoneEndpointId'
           FROM provisioning_runs WHERE client_id=$1 AND id=$5
         )`,
        [clientId, now, error.slice(0, 300), rollback?.status ?? null, runId],
      );
      await connection.query("COMMIT");
    } catch (cause) {
      await connection.query("ROLLBACK");
      throw cause;
    } finally {
      connection.release();
    }
  }
  async enqueueOnboardingJob(job: OnboardingJob) {
    const r = await this.pool.query(
      `INSERT INTO onboarding_jobs
       (id, client_id, kind, idempotency_key, status, payload, attempt_count, max_attempts,
        available_at, lease_owner, lease_expires_at, last_error, completed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (client_id, idempotency_key) DO NOTHING RETURNING id`,
      [job.id, job.clientId, job.kind, job.idempotencyKey, job.status, job.payload,
        job.attemptCount, job.maxAttempts, job.availableAt, job.leaseOwner ?? null,
        job.leaseExpiresAt ?? null, job.lastError ?? null, job.completedAt ?? null,
        job.createdAt, job.updatedAt],
    );
    return r.rowCount === 1;
  }
  async claimOnboardingJobs(workerId: string, nowIso: string, leaseSeconds: number, limit: number) {
    const r = await this.pool.query(
      `WITH claimable AS (
         SELECT id FROM onboarding_jobs
         WHERE attempt_count < max_attempts
           AND available_at <= $2::timestamptz
           AND (status = 'pending' OR (status = 'leased' AND lease_expires_at <= $2::timestamptz))
         ORDER BY available_at, created_at, id
         FOR UPDATE SKIP LOCKED LIMIT $4
       )
       UPDATE onboarding_jobs j
       SET status = 'leased', lease_owner = $1,
           lease_expires_at = $2::timestamptz + ($3::int * interval '1 second'),
           attempt_count = j.attempt_count + 1, updated_at = $2::timestamptz
       FROM claimable WHERE j.id = claimable.id RETURNING j.*`,
      [workerId, nowIso, Math.max(1, leaseSeconds), Math.max(0, limit)],
    );
    return r.rows.map(onboardingJobFromRow);
  }
  async extendOnboardingJobLease(
    clientId: string,
    id: string,
    workerId: string,
    nowIso: string,
    leaseSeconds: number,
  ) {
    const r = await this.pool.query(
      `UPDATE onboarding_jobs
       SET lease_expires_at=$4::timestamptz+($5::int*interval '1 second'),updated_at=$4
       WHERE client_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3 RETURNING id`,
      [clientId, id, workerId, nowIso, Math.max(1, leaseSeconds)],
    );
    return r.rowCount === 1;
  }
  async completeOnboardingJob(clientId: string, id: string, workerId: string, completedAt: string) {
    const r = await this.pool.query(
      `UPDATE onboarding_jobs SET status='completed', completed_at=$4, updated_at=$4,
       lease_owner=NULL, lease_expires_at=NULL
       WHERE client_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3 RETURNING id`,
      [clientId, id, workerId, completedAt],
    );
    return r.rowCount === 1;
  }
  async retryOnboardingJob(clientId: string, id: string, workerId: string, error: string, availableAt: string) {
    const r = await this.pool.query(
      `UPDATE onboarding_jobs SET status='pending', last_error=$4, available_at=$5,
       updated_at=$5, lease_owner=NULL, lease_expires_at=NULL
       WHERE client_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3
         AND attempt_count < max_attempts RETURNING id`,
      [clientId, id, workerId, error, availableAt],
    );
    return r.rowCount === 1;
  }
  async deadLetterOnboardingJob(clientId: string, id: string, workerId: string, error: string, failedAt: string) {
    const r = await this.pool.query(
      `UPDATE onboarding_jobs SET status='dead_letter', last_error=$4, updated_at=$5,
       lease_owner=NULL, lease_expires_at=NULL
       WHERE client_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3 RETURNING id`,
      [clientId, id, workerId, error, failedAt],
    );
    return r.rowCount === 1;
  }
  async getOnboardingJob(clientId: string, id: string) {
    const r = await this.pool.query("SELECT * FROM onboarding_jobs WHERE client_id=$1 AND id=$2", [clientId, id]);
    return r.rows[0] ? onboardingJobFromRow(r.rows[0]) : undefined;
  }
  async saveOnboardingOutbox(event: OnboardingOutboxEvent) {
    const r = await this.pool.query(
      `INSERT INTO onboarding_outbox
       (id,client_id,topic,idempotency_key,payload,published_at,attempt_count,last_error,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (client_id,idempotency_key) DO NOTHING RETURNING id`,
      [event.id,event.clientId,event.topic,event.idempotencyKey,event.payload,event.publishedAt ?? null,
        event.attemptCount,event.lastError ?? null,event.createdAt,event.updatedAt],
    );
    return r.rowCount === 1;
  }
  async listPendingOnboardingOutbox(limit = 100) {
    const r = await this.pool.query(
      "SELECT * FROM onboarding_outbox WHERE published_at IS NULL ORDER BY created_at,id LIMIT $1",
      [Math.max(1, Math.min(limit, 500))],
    );
    return r.rows.map(onboardingOutboxFromRow);
  }
  async enqueueNotification(delivery: NotificationDelivery) {
    const r = await this.pool.query(
      `INSERT INTO notification_deliveries
       (id,client_id,operation_id,idempotency_key,channel,recipient,template,status,provider_id,
        attempt_count,max_attempts,next_attempt_at,lease_owner,lease_expires_at,last_error,
        delivered_at,dead_lettered_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (client_id,idempotency_key) DO NOTHING RETURNING id`,
      [delivery.id, delivery.clientId, delivery.operationId, delivery.idempotencyKey,
        delivery.channel, delivery.recipient, delivery.template, delivery.status,
        delivery.providerId ?? null, delivery.attemptCount, delivery.maxAttempts,
        delivery.nextAttemptAt, delivery.leaseOwner ?? null, delivery.leaseExpiresAt ?? null,
        delivery.lastError ?? null, delivery.deliveredAt ?? null, delivery.deadLetteredAt ?? null,
        delivery.createdAt, delivery.updatedAt],
    );
    return r.rowCount === 1;
  }
  async claimNotifications(workerId: string, nowIso: string, leaseSeconds: number, limit: number) {
    const r = await this.pool.query(
      `WITH claimable AS (
         SELECT id FROM notification_deliveries
         WHERE attempt_count < max_attempts AND next_attempt_at <= $2::timestamptz
           AND (status='pending' OR (status='leased' AND lease_expires_at <= $2::timestamptz))
         ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $4
       )
       UPDATE notification_deliveries n SET status='leased',lease_owner=$1,
         lease_expires_at=$2::timestamptz+($3::int*interval '1 second'),
         attempt_count=n.attempt_count+1,updated_at=$2
       FROM claimable WHERE n.id=claimable.id RETURNING n.*`,
      [workerId, nowIso, Math.max(1, leaseSeconds), Math.max(0, limit)],
    );
    return r.rows.map(notificationFromRow);
  }
  async completeNotification(clientId: string, id: string, workerId: string, providerId: string, deliveredAt: string) {
    const r = await this.pool.query(
      `UPDATE notification_deliveries SET status='delivered',provider_id=$4,delivered_at=$5,
       updated_at=$5,lease_owner=NULL,lease_expires_at=NULL
       WHERE client_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3 RETURNING id`,
      [clientId, id, workerId, providerId, deliveredAt],
    );
    return r.rowCount === 1;
  }
  async retryNotification(clientId: string, id: string, workerId: string, error: string, nextAttemptAt: string) {
    const r = await this.pool.query(
      `UPDATE notification_deliveries SET status='pending',last_error=$4,next_attempt_at=$5,
       updated_at=$5,lease_owner=NULL,lease_expires_at=NULL
       WHERE client_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3
         AND attempt_count < max_attempts RETURNING id`,
      [clientId, id, workerId, error, nextAttemptAt],
    );
    return r.rowCount === 1;
  }
  async deadLetterNotification(clientId: string, id: string, workerId: string, error: string, failedAt: string) {
    const r = await this.pool.query(
      `UPDATE notification_deliveries SET status='dead_letter',last_error=$4,dead_lettered_at=$5,
       updated_at=$5,lease_owner=NULL,lease_expires_at=NULL
       WHERE client_id=$1 AND id=$2 AND status='leased' AND lease_owner=$3 RETURNING id`,
      [clientId, id, workerId, error, failedAt],
    );
    return r.rowCount === 1;
  }
  async listNotifications(clientId: string, limit = 100) {
    const r = await this.pool.query(
      "SELECT * FROM notification_deliveries WHERE client_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2",
      [clientId, Math.max(1, Math.min(limit, 500))],
    );
    return r.rows.map(notificationFromRow);
  }
  async notificationHealth(nowIso: string) {
    const r = await this.pool.query(
      `SELECT count(*) FILTER (WHERE status='pending') pending,
        count(*) FILTER (WHERE status='leased') leased,
        count(*) FILTER (WHERE status='dead_letter') dead_letter,
        min(created_at) FILTER (WHERE status='pending') oldest_pending_at,
        count(*) FILTER (WHERE last_error IS NOT NULL AND updated_at >= $1::timestamptz-interval '24 hours') failures
       FROM notification_deliveries`,
      [nowIso],
    );
    const row = r.rows[0];
    return {
      pending: Number(row.pending), leased: Number(row.leased), deadLetter: Number(row.dead_letter),
      oldestPendingAt: row.oldest_pending_at?.toISOString?.() || row.oldest_pending_at || undefined,
      providerFailures24h: Number(row.failures),
    };
  }
  async saveWebsiteSource(source: WebsiteSource) {
    await this.pool.query(
      `INSERT INTO website_sources (id,client_id,url,status,checksum,last_fetched_at,metadata,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET url=EXCLUDED.url,status=EXCLUDED.status,checksum=EXCLUDED.checksum,
       last_fetched_at=EXCLUDED.last_fetched_at,metadata=EXCLUDED.metadata,updated_at=EXCLUDED.updated_at
       WHERE website_sources.client_id=EXCLUDED.client_id`,
      [source.id,source.clientId,source.url,source.status,source.checksum ?? null,
        source.lastFetchedAt ?? null,source.metadata,source.createdAt,source.updatedAt],
    );
  }
  async getWebsiteSource(clientId: string, id: string) {
    const r = await this.pool.query(
      "SELECT * FROM website_sources WHERE client_id=$1 AND id=$2",
      [clientId, id],
    );
    return r.rows[0] ? websiteSourceFromRow(r.rows[0]) : undefined;
  }
  async listWebsiteSources(clientId: string) {
    const r = await this.pool.query("SELECT * FROM website_sources WHERE client_id=$1 ORDER BY created_at,id", [clientId]);
    return r.rows.map(websiteSourceFromRow);
  }
  async saveWebsiteExtractionRun(run: WebsiteExtractionRun) {
    await this.pool.query(
      `INSERT INTO website_extraction_runs
       (id,client_id,source_id,status,extractor_version,started_at,finished_at,error,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,started_at=EXCLUDED.started_at,
       finished_at=EXCLUDED.finished_at,error=EXCLUDED.error,updated_at=EXCLUDED.updated_at
       WHERE website_extraction_runs.client_id=EXCLUDED.client_id`,
      [run.id,run.clientId,run.sourceId,run.status,run.extractorVersion,run.startedAt ?? null,
        run.finishedAt ?? null,run.error ?? null,run.createdAt,run.updatedAt],
    );
  }
  async getWebsiteExtractionRun(clientId: string, id: string) {
    const r = await this.pool.query(
      "SELECT * FROM website_extraction_runs WHERE client_id=$1 AND id=$2",
      [clientId, id],
    );
    return r.rows[0] ? websiteExtractionRunFromRow(r.rows[0]) : undefined;
  }
  async listWebsiteExtractionRuns(clientId: string, sourceId?: string) {
    const r = await this.pool.query(
      "SELECT * FROM website_extraction_runs WHERE client_id=$1 AND ($2::text IS NULL OR source_id=$2) ORDER BY created_at,id",
      [clientId, sourceId ?? null],
    );
    return r.rows.map(websiteExtractionRunFromRow);
  }
  async replaceExtractedFacts(clientId: string, runId: string, facts: ExtractedFact[]) {
    if (facts.some((fact) => fact.clientId !== clientId || fact.extractionRunId !== runId)) throw new Error("tenant_mismatch");
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("DELETE FROM extracted_facts WHERE client_id=$1 AND extraction_run_id=$2", [clientId, runId]);
      for (const fact of facts) {
        await connection.query(
          `INSERT INTO extracted_facts
           (id,client_id,extraction_run_id,key,value,confidence,source_evidence,
            review_status,reviewed_by,reviewed_at,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [fact.id,clientId,runId,fact.key,JSON.stringify(fact.value),fact.confidence ?? null,
            fact.sourceEvidence ?? null,fact.reviewStatus,fact.reviewedBy ?? null,
            fact.reviewedAt ?? null,fact.createdAt],
        );
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK"); throw error;
    } finally { connection.release(); }
  }
  async saveExtractedFact(fact: ExtractedFact) {
    const r = await this.pool.query(
      `UPDATE extracted_facts SET value=$4,confidence=$5,source_evidence=$6,
       review_status=$7,reviewed_by=$8,reviewed_at=$9
       WHERE client_id=$1 AND id=$2 AND extraction_run_id=$3 RETURNING id`,
      [fact.clientId,fact.id,fact.extractionRunId,JSON.stringify(fact.value),fact.confidence ?? null,
        fact.sourceEvidence ?? null,fact.reviewStatus,fact.reviewedBy ?? null,fact.reviewedAt ?? null],
    );
    if (r.rowCount !== 1) throw new Error("extracted_fact_not_found");
  }
  async listExtractedFacts(clientId: string, runId: string) {
    const r = await this.pool.query(
      "SELECT * FROM extracted_facts WHERE client_id=$1 AND extraction_run_id=$2 ORDER BY key,id",
      [clientId, runId],
    );
    return r.rows.map(extractedFactFromRow);
  }
  async upsertOnboardingGap(gap: OnboardingGap) {
    await this.pool.query(
      `INSERT INTO onboarding_gaps (id,client_id,key,status,detail,resolved_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id,key) DO UPDATE SET status=EXCLUDED.status,detail=EXCLUDED.detail,
       resolved_at=EXCLUDED.resolved_at,updated_at=EXCLUDED.updated_at`,
      [gap.id,gap.clientId,gap.key,gap.status,gap.detail ?? null,gap.resolvedAt ?? null,gap.createdAt,gap.updatedAt],
    );
  }
  async listOnboardingGaps(clientId: string) {
    const r = await this.pool.query("SELECT * FROM onboarding_gaps WHERE client_id=$1 ORDER BY created_at,id", [clientId]);
    return r.rows.map(onboardingGapFromRow);
  }
  async getOnboardingWizard(clientId: string) {
    const r = await this.pool.query(
      "SELECT * FROM onboarding_wizard_states WHERE client_id=$1",
      [clientId],
    );
    return r.rows[0] ? onboardingWizardFromRow(r.rows[0]) : undefined;
  }
  async saveOnboardingWizard(state: OnboardingWizardState) {
    await this.pool.query(
      `INSERT INTO onboarding_wizard_states
       (client_id,current_step,completed_steps,data,version,submitted_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO UPDATE SET current_step=EXCLUDED.current_step,
       completed_steps=EXCLUDED.completed_steps,data=EXCLUDED.data,version=EXCLUDED.version,
       submitted_at=EXCLUDED.submitted_at,updated_at=EXCLUDED.updated_at`,
      [state.clientId,state.currentStep,state.completedSteps,state.data,state.version,
        state.submittedAt ?? null,state.createdAt,state.updatedAt],
    );
  }
  async upsertProviderResource(resource: ProviderResource) {
    const conflict = resource.providerResourceId
      ? `ON CONFLICT (client_id,provider,provider_resource_id)
           WHERE provider_resource_id IS NOT NULL
         DO UPDATE SET lifecycle_status=EXCLUDED.lifecycle_status,
           credential_ref=EXCLUDED.credential_ref,
           encrypted_credential=EXCLUDED.encrypted_credential,metadata=EXCLUDED.metadata,
           last_error=EXCLUDED.last_error,updated_at=EXCLUDED.updated_at`
      : `ON CONFLICT (id) DO UPDATE SET provider_resource_id=EXCLUDED.provider_resource_id,
           lifecycle_status=EXCLUDED.lifecycle_status,credential_ref=EXCLUDED.credential_ref,
           encrypted_credential=EXCLUDED.encrypted_credential,metadata=EXCLUDED.metadata,
           last_error=EXCLUDED.last_error,updated_at=EXCLUDED.updated_at
         WHERE provider_resources.client_id=EXCLUDED.client_id`;
    await this.pool.query(
      `INSERT INTO provider_resources
       (id,client_id,provider,resource_type,provider_resource_id,lifecycle_status,credential_ref,
        encrypted_credential,metadata,last_error,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ${conflict}`,
      [resource.id,resource.clientId,resource.provider,resource.resourceType,resource.providerResourceId ?? null,
        resource.lifecycleStatus,resource.credentialRef ?? null,resource.encryptedCredential ?? null,
        resource.metadata,resource.lastError ?? null,resource.createdAt,resource.updatedAt],
    );
  }
  async listProviderResources(clientId: string) {
    const r = await this.pool.query("SELECT * FROM provider_resources WHERE client_id=$1 ORDER BY created_at,id", [clientId]);
    return r.rows.map(providerResourceFromRow);
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
    const result = await this.pool.query(
      `INSERT INTO call_sessions (id, client_id, payload, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
       WHERE call_sessions.client_id = EXCLUDED.client_id
       RETURNING id`,
      [c.id, c.clientId, c],
    );
    if (result.rowCount !== 1) {
      throw new Error("call_session_tenant_conflict");
    }
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
  async deleteLifecycleDataOlderThan(isoDate: string) {
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      const websiteFacts = await connection.query(
        `DELETE FROM extracted_facts f USING website_extraction_runs r,website_sources s
         WHERE f.client_id=r.client_id AND f.extraction_run_id=r.id
           AND r.client_id=s.client_id AND r.source_id=s.id
           AND s.status IN ('disabled','failed') AND f.created_at < $1`,
        [isoDate],
      );
      const providerResources = await connection.query(
        "DELETE FROM provider_resources WHERE lifecycle_status='deleted' AND updated_at < $1", [isoDate],
      );
      const jobs = await connection.query(
        "DELETE FROM onboarding_jobs WHERE status IN ('completed','dead_letter') AND updated_at < $1", [isoDate],
      );
      const notifications = await connection.query(
        "DELETE FROM notification_deliveries WHERE status IN ('delivered','dead_letter') AND updated_at < $1", [isoDate],
      );
      await connection.query("COMMIT");
      return {
        websiteFacts: websiteFacts.rowCount ?? 0,
        providerResources: providerResources.rowCount ?? 0,
        jobs: jobs.rowCount ?? 0,
        notifications: notifications.rowCount ?? 0,
      };
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
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
    termsAcceptedAt: row.terms_accepted_at ? toIso(row.terms_accepted_at) : undefined,
    privacyAcceptedAt: row.privacy_accepted_at ? toIso(row.privacy_accepted_at) : undefined,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function tenantRequestFromRow(row: Record<string, any>): TenantRequest {
  return {
    id: row.id,
    clientId: row.client_id,
    type: row.type,
    status: row.status,
    requestedBy: row.requested_by,
    email: row.email ?? undefined,
    payload: row.payload ?? {},
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
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
    encryptedAccountAuthToken: row.encrypted_account_auth_token ?? undefined,
    selectedPhoneNumber: row.selected_phone_number ?? undefined,
    regulatoryBundleSid: row.regulatory_bundle_sid ?? undefined,
    emergencyAddressSid: row.emergency_address_sid ?? undefined,
    monthlySpendCapPence: row.monthly_spend_cap_pence === null ? undefined : Number(row.monthly_spend_cap_pence),
    purchaseConfirmedBy: row.purchase_confirmed_by ?? undefined,
    purchaseConfirmedAt: row.purchase_confirmed_at ? toIso(row.purchase_confirmed_at) : undefined,
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
    mode: row.connection_mode ?? undefined,
    encryptedAccessToken: row.encrypted_access_token ?? undefined,
    encryptedRefreshToken: row.encrypted_refresh_token ?? undefined,
    accessTokenExpiresAt: row.access_token_expires_at ? toIso(row.access_token_expires_at) : undefined,
    scopes: row.scopes ?? [],
    destinationProvider: row.destination_provider ?? undefined,
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
    readinessOnly: Boolean(row.readiness_only),
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
    claimToken: row.claim_token ?? undefined,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function onboardingJobFromRow(row: Record<string, any>): OnboardingJob {
  return {
    id: row.id, clientId: row.client_id, kind: row.kind, idempotencyKey: row.idempotency_key,
    status: row.status, payload: row.payload ?? {}, attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts), availableAt: toIso(row.available_at),
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ? toIso(row.lease_expires_at) : undefined,
    lastError: row.last_error ?? undefined,
    completedAt: row.completed_at ? toIso(row.completed_at) : undefined,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function onboardingOutboxFromRow(row: Record<string, any>): OnboardingOutboxEvent {
  return {
    id: row.id, clientId: row.client_id, topic: row.topic, idempotencyKey: row.idempotency_key,
    payload: row.payload ?? {}, publishedAt: row.published_at ? toIso(row.published_at) : undefined,
    attemptCount: Number(row.attempt_count), lastError: row.last_error ?? undefined,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function notificationFromRow(row: Record<string, any>): NotificationDelivery {
  return {
    id: row.id, clientId: row.client_id, operationId: row.operation_id,
    idempotencyKey: row.idempotency_key, channel: row.channel, recipient: row.recipient,
    template: row.template, status: row.status, providerId: row.provider_id ?? undefined,
    attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts),
    nextAttemptAt: toIso(row.next_attempt_at), leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ? toIso(row.lease_expires_at) : undefined,
    lastError: row.last_error ?? undefined,
    deliveredAt: row.delivered_at ? toIso(row.delivered_at) : undefined,
    deadLetteredAt: row.dead_lettered_at ? toIso(row.dead_lettered_at) : undefined,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function websiteSourceFromRow(row: Record<string, any>): WebsiteSource {
  return {
    id: row.id, clientId: row.client_id, url: row.url, status: row.status,
    checksum: row.checksum ?? undefined,
    lastFetchedAt: row.last_fetched_at ? toIso(row.last_fetched_at) : undefined,
    metadata: row.metadata ?? {}, createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function websiteExtractionRunFromRow(row: Record<string, any>): WebsiteExtractionRun {
  return {
    id: row.id, clientId: row.client_id, sourceId: row.source_id, status: row.status,
    extractorVersion: row.extractor_version,
    startedAt: row.started_at ? toIso(row.started_at) : undefined,
    finishedAt: row.finished_at ? toIso(row.finished_at) : undefined,
    error: row.error ?? undefined, createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function extractedFactFromRow(row: Record<string, any>): ExtractedFact {
  return {
    id: row.id, clientId: row.client_id, extractionRunId: row.extraction_run_id,
    key: row.key, value: row.value,
    confidence: row.confidence == null ? undefined : Number(row.confidence),
    sourceEvidence: row.source_evidence ?? undefined,
    reviewStatus: row.review_status ?? "extracted",
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ? toIso(row.reviewed_at) : undefined,
    createdAt: toIso(row.created_at),
  };
}

function onboardingGapFromRow(row: Record<string, any>): OnboardingGap {
  return {
    id: row.id, clientId: row.client_id, key: row.key, status: row.status,
    detail: row.detail ?? undefined, resolvedAt: row.resolved_at ? toIso(row.resolved_at) : undefined,
    createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
  };
}

function onboardingWizardFromRow(row: Record<string, any>): OnboardingWizardState {
  return {
    clientId: row.client_id,
    currentStep: row.current_step,
    completedSteps: row.completed_steps ?? [],
    data: row.data ?? {},
    version: Number(row.version),
    submittedAt: row.submitted_at ? toIso(row.submitted_at) : undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function providerResourceFromRow(row: Record<string, any>): ProviderResource {
  return {
    id: row.id, clientId: row.client_id, provider: row.provider, resourceType: row.resource_type,
    providerResourceId: row.provider_resource_id ?? undefined, lifecycleStatus: row.lifecycle_status,
    credentialRef: row.credential_ref ?? undefined, encryptedCredential: row.encrypted_credential ?? undefined,
    metadata: row.metadata ?? {}, lastError: row.last_error ?? undefined,
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

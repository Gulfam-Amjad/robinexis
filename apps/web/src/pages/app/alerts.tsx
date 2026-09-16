import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCircle2, CircleDollarSign, PlugZap } from "lucide-react";
import { api, formatDate } from "../../lib/api";
import { workspacePath } from "../../lib/navigation";
import { useClient } from "../../state";
import {
  Badge, Card, EmptyState, ErrorState, LinkButton, LoadingState, PageHeader, SectionHeading,
} from "../../components/ui";

export function AlertsPage() {
  const { activeClientId } = useClient();
  const clientId = activeClientId;
  const usage = useQuery({ queryKey: ["usage", clientId], queryFn: () => api.usage(clientId!), enabled: Boolean(clientId), retry: false });
  const billing = useQuery({ queryKey: ["billing-status", clientId], queryFn: () => api.billingStatus(clientId), enabled: Boolean(clientId), retry: false });
  const integrations = useQuery({ queryKey: ["integrations", clientId], queryFn: () => api.integrations(clientId!), enabled: Boolean(clientId), retry: false });
  const notifications = useQuery({ queryKey: ["notification-status", clientId], queryFn: () => api.notificationStatus(clientId!), enabled: Boolean(clientId), retry: false });
  const requests = useQuery({ queryKey: ["tenant-requests", clientId], queryFn: () => api.requests(clientId), enabled: Boolean(clientId), retry: false });
  if (!clientId) return <EmptyState title="No workspace selected" description="Choose a workspace to see its alerts." />;
  if (usage.isLoading || billing.isLoading || integrations.isLoading) return <LoadingState label="Checking workspace alerts…" />;
  if (usage.error && billing.error && integrations.error) return <ErrorState error={usage.error} onRetry={() => { usage.refetch(); billing.refetch(); integrations.refetch(); }} />;

  const remaining = usage.data?.periodRemainingMinutes ?? usage.data?.remainingMinutes;
  const disconnected = (integrations.data || []).filter((item) => !item.connected && ["calcom", "twilio", "elevenlabs"].includes(item.id.toLowerCase()));
  const openRequests = (requests.data || []).filter((item) => !["completed", "rejected", "revoked"].includes(item.status));
  const alerts = [
    ...(remaining !== undefined && remaining <= Math.max(30, (usage.data?.includedMinutes || 300) * 0.1)
      ? [{ key: "usage", title: `${remaining} voice minutes remaining`, detail: usage.data?.resetAt ? `Allowance resets ${formatDate(usage.data.resetAt, { dateStyle: "medium" })}.` : "Review your plan before calls are paused.", tone: "warning" as const, icon: CircleDollarSign, to: workspacePath(clientId, "usage") }]
      : []),
    ...(!["active", "trialing"].includes(billing.data?.status || "")
      ? [{ key: "billing", title: "Billing needs attention", detail: `Subscription status: ${(billing.data?.status || "unknown").replaceAll("_", " ")}.`, tone: "danger" as const, icon: CircleDollarSign, to: "/billing" }]
      : []),
    ...disconnected.map((item) => ({ key: `integration-${item.id}`, title: `${item.name} needs attention`, detail: "Reconnect it before relying on live calls or bookings.", tone: "warning" as const, icon: PlugZap, to: workspacePath(clientId, "connections") })),
  ];

  return <>
    <PageHeader eyebrow="Alerts" title="Important updates, without the noise" description="Only customer-impacting setup, billing, allowance and connection alerts appear here." />
    <div className="overview-grid">
      <Card className="panel">
        <SectionHeading title="Needs your attention" description={`${alerts.length} active alert${alerts.length === 1 ? "" : "s"}`} />
        {alerts.length ? <div className="team-list">{alerts.map(({ key, title, detail, tone, icon: Icon, to }) => <div className="team-row" key={key}><Icon /><div><strong>{title}</strong><small>{detail}</small></div><Badge tone={tone}>{tone === "danger" ? "Action required" : "Review"}</Badge><LinkButton to={to} variant="secondary">Open</LinkButton></div>)}</div> : <EmptyState icon={CheckCircle2} title="Everything looks good" description="There are no customer-impacting alerts for this workspace." />}
      </Card>
      <Card className="panel">
        <SectionHeading title="Delivery status" description="Lifecycle emails are tenant-scoped and never contain provider credentials." />
        <dl className="detail-list">
          <div><dt>Queued updates</dt><dd>{notifications.data?.pending ?? "Unavailable"}</dd></div>
          <div><dt>Failed deliveries</dt><dd>{notifications.data?.failed ?? "Unavailable"}</dd></div>
          <div><dt>Open support requests</dt><dd>{openRequests.length}</dd></div>
        </dl>
        <div className="inline-notice"><Bell /><div><strong>Essential alerts are always on</strong><p>Setup, billing, allowance and service-impacting notices are sent to the workspace contact. Ask support to change the destination safely.</p></div></div>
        <LinkButton to={workspacePath(clientId, "support")} variant="secondary">Manage through support</LinkButton>
      </Card>
    </div>
  </>;
}

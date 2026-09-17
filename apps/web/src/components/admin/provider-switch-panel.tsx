import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  Gauge,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { Client, ProviderBenchmarkMetrics } from "@robinexis/api-contracts";
import { api, formatDate } from "../../lib/api";
import { useToast } from "../../state";
import { Badge, Button, Card, SectionHeading } from "../ui";

type Provider = "elevenlabs-convai" | "livekit-cascade";

export function ProviderSwitchPanel({
  client,
  providerCost,
}: {
  client: Client;
  providerCost?: { estimatedCostMinor: number; usageMinutes: number; providers: string[] };
}) {
  const { push } = useToast();
  const [target, setTarget] = useState<Provider>(
    client.voicePipeline === "livekit-cascade" ? "elevenlabs-convai" : "livekit-cascade",
  );
  const [confirmation, setConfirmation] = useState("");
  const [operationId, setOperationId] = useState<string>();
  const [preparedTarget, setPreparedTarget] = useState<Provider>();
  const [deploymentId, setDeploymentId] = useState<string>();
  const [baseline, setBaseline] = useState("");
  const [candidate, setCandidate] = useState("");
  const health = useQuery({
    queryKey: ["provider-health", client.id],
    queryFn: () => api.providerHealth(client.id),
    retry: false,
  });
  const gate = useQuery({
    queryKey: ["provider-launch-gate", client.id, deploymentId],
    queryFn: () => api.providerLaunchGate(client.id, deploymentId!),
    enabled: Boolean(deploymentId && target === "livekit-cascade"),
    retry: false,
  });
  const operation = useQuery({
    queryKey: ["provider-switch-status", client.id, operationId],
    queryFn: () => api.providerSwitchStatus(client.id, operationId!),
    enabled: Boolean(operationId),
    retry: false,
    refetchInterval: (query) => ["in_progress", "rollback_in_progress"].includes(query.state.data?.status || "") ? 1_500 : false,
  });
  const prepare = useMutation({
    mutationFn: () => api.prepareProviderDeployment(client.id, target),
    onSuccess: (deployment) => {
      setPreparedTarget(deployment.provider as Provider);
      setDeploymentId(deployment.deploymentId);
      preview.reset();
      push({ title: "Staged deployment prepared", message: "Live call routing was not changed.", tone: "success" });
    },
    onError: (error) => push({ title: "Preparation blocked", message: error.message, tone: "error" }),
  });
  const evaluate = useMutation({
    mutationFn: () => api.evaluateProviderLaunchGate(client.id, {
      deploymentId: deploymentId!,
      candidateProvider: target,
      source: "manual",
      baseline: parseBenchmark(baseline),
      candidate: parseBenchmark(candidate),
    }),
    onSuccess: async () => {
      await gate.refetch();
      preview.reset();
      push({ title: "Quality gate stored", tone: "success" });
    },
    onError: (error) => push({ title: "Quality gate blocked", message: error.message, tone: "error" }),
  });
  const preview = useMutation({
    mutationFn: () => api.previewProviderSwitch(client.id, target),
    onError: (error) => push({ title: "Preflight blocked", message: error.message, tone: "error" }),
  });
  const switchProvider = useMutation({
    mutationFn: () => api.startProviderSwitch(client.id, {
      toProvider: target,
      idempotencyKey: crypto.randomUUID(),
      confirmation,
    }),
    onSuccess: (result) => {
      setOperationId(result.id);
      push({ title: result.status === "live" ? "Provider is live" : "Switch started", tone: "success" });
    },
    onError: (error) => push({ title: "Switch failed", message: error.message, tone: "error" }),
  });
  const rollback = useMutation({
    mutationFn: (id: string) => api.rollbackProviderSwitch(client.id, id, confirmation),
    onSuccess: (result) => {
      setOperationId(result.id);
      push({ title: "Rollback requested", tone: "success" });
    },
    onError: (error) => push({ title: "Rollback failed", message: error.message, tone: "error" }),
  });

  const active: Provider = client.voicePipeline === "livekit-cascade"
    ? "livekit-cascade"
    : "elevenlabs-convai";
  const protectedTenant = client.id === "client_blades_hair";
  const prepared = preparedTarget === target;
  const ready = preview.data?.status === "ready";
  const switchText = `SWITCH ${client.businessName}`;
  const rollbackText = `ROLLBACK ${client.businessName}`;

  return <Card className="panel provider-switch-panel" id="voice-routing">
    <SectionHeading
      title="Voice routing"
      description="Choose how this receptionist listens and thinks while preserving ElevenLabs speech."
      action={protectedTenant ? <Badge tone="warning"><LockKeyhole size={12} /> Protected</Badge> : <Badge tone={health.data?.status === "healthy" ? "success" : "warning"}>{health.data?.status || "Checking health"}</Badge>}
    />

    <div className="provider-choice-grid">
      <button className={`provider-choice ${target === "elevenlabs-convai" ? "selected" : ""}`} type="button" onClick={() => resetTarget("elevenlabs-convai")}>
        <span className="provider-choice-icon"><Sparkles /></span>
        <span><small>Premium mode</small><strong>ElevenLabs Premium</strong><em>ConvAI handles the complete conversation.</em></span>
        {active === "elevenlabs-convai" ? <Badge tone="accent">Active now</Badge> : target === "elevenlabs-convai" ? <Check /> : null}
      </button>
      <button className={`provider-choice ${target === "livekit-cascade" ? "selected" : ""}`} type="button" onClick={() => resetTarget("livekit-cascade")}>
        <span className="provider-choice-icon"><Gauge /></span>
        <span><small>Cost-efficient mode</small><strong>Cost Saver</strong><em>Deepgram + Groq + ElevenLabs TTS.</em></span>
        {active === "livekit-cascade" ? <Badge tone="success">Active now</Badge> : target === "livekit-cascade" ? <Check /> : null}
      </button>
    </div>

    <div className="routing-summary-strip">
      <div><small>Assigned mode</small><strong>{active === "livekit-cascade" ? "Cost Saver" : "ElevenLabs Premium"}</strong></div>
      <div><small>Provider health</small><strong>{health.data?.status || "Unavailable"}</strong></div>
      <div><small>Estimated provider cost</small><strong>{providerCost ? `£${(providerCost.estimatedCostMinor / 100).toFixed(2)}` : "No usage yet"}</strong></div>
      <div><small>Rollback</small><strong>{operation.data?.rollbackAvailable ? "Available" : "Created after a switch"}</strong></div>
    </div>

    {protectedTenant && <div className="notice notice-error"><div><LockKeyhole /><span><strong>Blades is protected.</strong> This workflow can be reviewed, but production routing cannot be changed.</span></div></div>}

    <div className="switch-stepper">
      <SwitchStep number="1" title="Readiness" status={health.data?.status === "healthy" ? "complete" : "current"}>
        <p>Confirm the customer is published and provider resources are healthy.</p>
        <div className="step-checks">
          <span>{client.published ? <CheckCircle2 /> : <ShieldAlert />} Published configuration</span>
          <span>{health.data?.status === "healthy" ? <CheckCircle2 /> : <ShieldAlert />} Provider health {health.data?.status || "pending"}</span>
        </div>
      </SwitchStep>
      <SwitchStep number="2" title="Prepare target" status={prepared ? "complete" : "current"}>
        <p>Create an isolated target deployment. This does not route customer calls.</p>
        <Button variant="secondary" disabled={prepare.isPending || target === active || protectedTenant} onClick={() => prepare.mutate()}>
          {prepare.isPending ? "Preparing…" : `Prepare ${target === "livekit-cascade" ? "Cost Saver" : "ElevenLabs Premium"}`}
        </Button>
        {target === active && <span className="step-note">This provider is already active.</span>}
      </SwitchStep>
      <SwitchStep number="3" title="Quality gate" status={gate.data?.passed ? "complete" : prepared ? "current" : "locked"}>
        <p>Store measured comparison evidence before Cost Saver can go live.</p>
        {target === "livekit-cascade" && prepared && <details className="benchmark-details">
          <summary>Enter benchmark evidence</summary>
          <div className="benchmark-grid">
            <label>Premium baseline JSON<textarea rows={8} value={baseline} onChange={(event) => setBaseline(event.target.value)} placeholder="Paste measured baseline JSON" /></label>
            <label>Cost Saver candidate JSON<textarea rows={8} value={candidate} onChange={(event) => setCandidate(event.target.value)} placeholder="Paste measured candidate JSON" /></label>
          </div>
          <Button variant="secondary" disabled={evaluate.isPending || !baseline || !candidate} onClick={() => evaluate.mutate()}>Evaluate quality gate</Button>
        </details>}
        {gate.data && <div className={`gate-result ${gate.data.passed ? "passed" : "blocked"}`}><strong>{gate.data.passed ? "Quality gate passed" : "Quality gate blocked"}</strong><small>Evaluated {formatDate(gate.data.evaluatedAt)}</small><ul>{gate.data.checks.map((check) => <li key={check.key}>{check.passed ? "✓" : "×"} {check.detail}</li>)}</ul></div>}
        {target === "elevenlabs-convai" && prepared && <span className="step-note">Premium rollback does not require a Cost Saver benchmark.</span>}
      </SwitchStep>
      <SwitchStep number="4" title="Confirm switch" status={ready ? "current" : "locked"}>
        <p>Run the final routing preflight, then type the exact customer confirmation.</p>
        <Button variant="secondary" disabled={preview.isPending || !prepared || protectedTenant} onClick={() => preview.mutate()}><ShieldAlert size={15} /> Run final preflight</Button>
        {preview.data && <div className={`gate-result ${ready ? "passed" : "blocked"}`}><strong>{ready ? "Ready to switch" : preview.data.featureEnabled ? "Requirements incomplete" : "Routing locked by platform flag"}</strong><ul>{preview.data.checks.map((check) => <li key={check.key}>{check.passed ? "✓" : "×"} {check.detail}</li>)}</ul></div>}
        {ready && <div className="confirmation-block"><label>Type <strong>{switchText}</strong><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><Button disabled={switchProvider.isPending || confirmation !== switchText} onClick={() => switchProvider.mutate()}>Switch provider</Button></div>}
      </SwitchStep>
      <SwitchStep number="5" title="Observe or roll back" status={operation.data ? "current" : "locked"}>
        <p>Watch the operation result. Rollback remains explicit and audited.</p>
        {operation.data && <div className="gate-result passed"><strong>Status: {operation.data.status.replaceAll("_", " ")}</strong>{operation.data.error && <small>{operation.data.error}</small>}</div>}
        {operation.data?.rollbackAvailable && <div className="confirmation-block"><label>Type <strong>{rollbackText}</strong><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><Button variant="secondary" disabled={rollback.isPending || confirmation !== rollbackText} onClick={() => rollback.mutate(operation.data!.id)}><RefreshCw size={15} /> Roll back provider</Button></div>}
      </SwitchStep>
    </div>
  </Card>;

  function resetTarget(next: Provider) {
    setTarget(next);
    setPreparedTarget(undefined);
    setDeploymentId(undefined);
    setConfirmation("");
    preview.reset();
  }
}

function SwitchStep({
  number,
  title,
  status,
  children,
}: {
  number: string;
  title: string;
  status: "complete" | "current" | "locked";
  children: React.ReactNode;
}) {
  return <section className={`switch-step switch-step-${status}`}>
    <div className="switch-step-marker">{status === "complete" ? <Check size={15} /> : number}</div>
    <div className="switch-step-content"><div className="switch-step-title"><h3>{title}</h3><Badge tone={status === "complete" ? "success" : status === "locked" ? "neutral" : "accent"}>{status}</Badge></div>{children}</div>
  </section>;
}

function parseBenchmark(value: string): ProviderBenchmarkMetrics {
  const parsed = JSON.parse(value) as ProviderBenchmarkMetrics;
  if (!parsed || typeof parsed !== "object") throw new Error("Benchmark must be a JSON object.");
  return parsed;
}

import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Gauge, Scale, Sparkles } from "lucide-react";
import { CostSaverCall } from "../../components/CostSaverCall";
import { ReceptionistCall } from "../../components/ReceptionistCall";
import {
  Badge,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionHeading,
} from "../../components/ui";
import { api } from "../../lib/api";
import { ExclusiveVoiceSession, type VoiceProvider } from "../../lib/exclusiveVoiceSession";
import { workspaceReceptionistDemo } from "../../lib/receptionistDemo";

const BLADES_HAIR_ID = "client_blades_hair";

export default function AdminProviderComparisonPage() {
  const [activeProvider, setActiveProvider] = useState<VoiceProvider | null>(null);
  const voiceSession = useRef(new ExclusiveVoiceSession());
  const client = useQuery({
    queryKey: ["client", BLADES_HAIR_ID],
    queryFn: () => api.client(BLADES_HAIR_ID),
    retry: false,
  });
  const readiness = useQuery({
    queryKey: ["provider-comparison-readiness"],
    queryFn: api.providerComparisonReadiness,
    retry: false,
  });
  const acquire = useCallback((provider: VoiceProvider) => {
    const acquired = voiceSession.current.acquire(provider);
    if (acquired) setActiveProvider(provider);
    return acquired;
  }, []);
  const release = useCallback((provider: VoiceProvider) => {
    if (voiceSession.current.release(provider)) setActiveProvider(null);
  }, []);
  const premiumActive = useCallback((active: boolean) => {
    if (active) acquire("premium");
    else release("premium");
  }, [acquire, release]);
  const costSaverActive = useCallback((active: boolean) => {
    if (active) acquire("cost-saver");
    else release("cost-saver");
  }, [acquire, release]);
  const requestPremium = useCallback(() => acquire("premium"), [acquire]);
  const requestCostSaver = useCallback(() => acquire("cost-saver"), [acquire]);

  if (client.isLoading || readiness.isLoading) {
    return <LoadingState label="Loading the Blades provider comparison…" />;
  }
  if (client.error) return <ErrorState error={client.error} onRetry={() => client.refetch()} />;
  if (!client.data?.elevenlabsAgentId) {
    return <ErrorState error={new Error("The Blades Hair Premium agent is not connected.")} />;
  }

  const demo = workspaceReceptionistDemo({
    agentId: client.data.elevenlabsAgentId,
    businessName: client.data.businessName,
    location: client.data.location,
    phone: client.data.phone,
    greeting: client.data.greeting,
  });
  const costSaverReady = readiness.data?.costSaver.ready === true;
  const unavailableReason = readiness.error
    ? "Readiness could not be checked. The Cost Saver call remains disabled."
    : readiness.data?.costSaver.reason;

  return <>
    <PageHeader
      eyebrow="Platform · Voice lab"
      title="Voice comparison playground"
      description="Talk to both Blades Hair receptionists with the same published salon brief. Only one microphone session can run at a time."
    />

    <Card className="comparison-shared-brief">
      <SectionHeading
        title="One brief, two voice pipelines"
        description="Both agents use Blades Hair’s approved greeting, services, hours, prices, policies and booking tools."
        action={<Badge tone="success"><CheckCircle2 size={13} /> Same salon data</Badge>}
      />
      <div className="comparison-brief-facts">
        <span><strong>Business</strong>{client.data.businessName}</span>
        <span><strong>Hours</strong>{client.data.hours || "Not published"}</span>
        <span><strong>Services</strong>{client.data.services?.length || 0} approved service groups</span>
        <span><strong>Safety</strong>No phone routing changes</span>
      </div>
    </Card>

    <div className="comparison-summary-grid">
      <Card className="comparison-summary-card comparison-premium">
        <div><span><Sparkles /></span><div><small>Expensive baseline</small><h2>ElevenLabs Premium</h2></div><Badge tone="accent">Ready</Badge></div>
        <p>ElevenLabs handles listening, reasoning, turn-taking and speech end to end.</p>
        <ul><li>Flagship turn-taking and interruption handling</li><li>Single managed conversational provider</li><li>Current Blades production-quality baseline</li></ul>
      </Card>
      <Card className="comparison-summary-card comparison-saver">
        <div><span><Gauge /></span><div><small>Lower-cost candidate</small><h2>Cost Saver</h2></div><Badge tone={costSaverReady ? "success" : "warning"}>{costSaverReady ? "Ready" : "Setup needed"}</Badge></div>
        <p>Deepgram listens, Groq reasons, and ElevenLabs Flash speaks through LiveKit.</p>
        <ul><li>Separate component-level cost visibility</li><li>Same Blades prompt and operational tools</li><li>Measure quality and latency before routing customers</li></ul>
      </Card>
    </div>

    <div className="comparison-test-heading">
      <div><Scale /><span><strong>Live A/B test</strong><small>Use the same question on each side, then compare naturally.</small></span></div>
      {activeProvider && <Badge tone="warning">{activeProvider === "premium" ? "Premium" : "Cost Saver"} microphone active</Badge>}
    </div>

    <div className="comparison-agents-grid">
      <Card className="comparison-agent-panel">
        <div className="comparison-agent-label"><Sparkles /><span><small>Test A</small><strong>ElevenLabs Premium</strong></span></div>
        <ReceptionistCall
          config={demo}
          compact
          disabled={activeProvider === "cost-saver"}
          requestStart={requestPremium}
          onActiveChange={premiumActive}
        />
      </Card>
      <Card className="comparison-agent-panel">
        <div className="comparison-agent-label"><Gauge /><span><small>Test B</small><strong>Cost Saver</strong></span></div>
        <CostSaverCall
          config={demo}
          available={costSaverReady}
          unavailableReason={unavailableReason}
          disabled={activeProvider === "premium"}
          requestStart={requestCostSaver}
          onActiveChange={costSaverActive}
        />
        {!costSaverReady && readiness.data?.costSaver.missing.length ? (
          <div className="comparison-readiness" role="status">
            <strong>Runtime settings still required</strong>
            <p>{readiness.data.costSaver.missing.join(" · ")}</p>
          </div>
        ) : null}
      </Card>
    </div>

    <Card className="comparison-test-script">
      <SectionHeading title="Use the same questions on both calls" description="This keeps the client comparison fair and easy to hear." />
      <div>{demo.scenarios.map((scenario, index) => <span key={scenario}><b>{index + 1}</b>{scenario}</span>)}</div>
      <p>Compare: first response speed, naturalness, interruption recovery, factual accuracy and booking flow. Cost claims stay unlabelled until real usage telemetry exists.</p>
    </Card>
  </>;
}

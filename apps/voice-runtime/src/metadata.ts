import { createHash } from "node:crypto";

export interface RuntimeJobMetadata {
  tenantId: string;
  deploymentId: string;
  direction: "inbound" | "outbound";
  objective: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function parseJobMetadata(raw: string): RuntimeJobMetadata {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid_job_metadata_json");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_job_metadata");
  }
  const input = value as Record<string, unknown>;
  if ("clientId" in input) throw new Error("caller_client_id_forbidden");
  if ("providerJobId" in input) throw new Error("caller_provider_job_id_forbidden");
  const tenantId = String(input.tenantId || "").trim();
  const deploymentId = String(input.deploymentId || "").trim();
  const direction = input.direction === "outbound" ? "outbound" : input.direction === "inbound" ? "inbound" : "";
  const objective = String(input.objective || "").trim();
  if (!ID.test(tenantId) || !ID.test(deploymentId) || !direction || !objective || objective.length > 500) {
    throw new Error("invalid_job_metadata");
  }
  return { tenantId, deploymentId, direction, objective };
}

export function stableCallId(tenantId: string, providerJobId: string): string {
  if (!ID.test(tenantId) || !ID.test(providerJobId)) throw new Error("invalid_call_identity");
  return `call_${createHash("sha256")
    .update(`livekit-cascade\0${tenantId}\0${providerJobId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

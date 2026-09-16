import { createHash } from "node:crypto";

export interface RuntimeJobMetadata {
  tenantId: string;
  providerJobId: string;
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
  const tenantId = String(input.tenantId || "").trim();
  const providerJobId = String(input.providerJobId || "").trim();
  const direction = input.direction === "outbound" ? "outbound" : input.direction === "inbound" ? "inbound" : "";
  const objective = String(input.objective || "").trim();
  if (!ID.test(tenantId) || !ID.test(providerJobId) || !direction || !objective || objective.length > 500) {
    throw new Error("invalid_job_metadata");
  }
  return { tenantId, providerJobId, direction, objective };
}

export function stableCallId(metadata: Pick<RuntimeJobMetadata, "tenantId" | "providerJobId">): string {
  return `call_${createHash("sha256")
    .update(`livekit-cascade\0${metadata.tenantId}\0${metadata.providerJobId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

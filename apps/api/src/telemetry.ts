import { redactSecrets, structuredLog } from "@robinexis/database";

export function initializeBackendTelemetry() {
  structuredLog("telemetry_backend_initialized", {
    adapter: process.env.SENTRY_DSN ? "safe_sentry_adapter" : "structured_log",
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  });
}

export function captureBackendError(error: unknown, context: {
  tenantId?: string;
  operationId?: string;
  component: string;
}) {
  structuredLog("telemetry_backend_error", {
    ...context,
    error: redactSecrets(error instanceof Error ? error.message : String(error)),
  });
}

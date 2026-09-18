import * as Sentry from "@sentry/node";
import { redactSecrets, structuredLog } from "@robinexis/database";

export function initializeWorkerTelemetry() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_VERSION,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.request;
      delete event.user;
      return event;
    },
  });
  structuredLog("telemetry_worker_initialized", { adapter: "sentry" });
}

export function captureWorkerError(error: unknown, component: string) {
  const message = String(redactSecrets(error instanceof Error ? error.message : String(error)));
  if (process.env.SENTRY_DSN) {
    const safeError = new Error(message);
    safeError.name = error instanceof Error ? error.name : "WorkerError";
    Sentry.captureException(safeError, { tags: { component } });
  }
  structuredLog("telemetry_worker_error", { component, error: message });
}

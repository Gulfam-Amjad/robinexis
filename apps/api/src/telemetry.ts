import { redactSecrets, structuredLog } from "@robinexis/database";
import * as Sentry from "@sentry/node";

export function initializeBackendTelemetry() {
  if (process.env.SENTRY_DSN) {
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
  }
  structuredLog("telemetry_backend_initialized", {
    adapter: process.env.SENTRY_DSN ? "sentry" : "structured_log",
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  });
}

export function captureBackendError(error: unknown, context: {
  tenantId?: string;
  operationId?: string;
  component: string;
}) {
  if (process.env.SENTRY_DSN) {
    const safeError = new Error(String(redactSecrets(error instanceof Error ? error.message : String(error))));
    safeError.name = error instanceof Error ? error.name : "BackendError";
    Sentry.captureException(safeError, {
      tags: { component: context.component },
      contexts: {
        operation: {
          tenantId: context.tenantId,
          operationId: context.operationId,
        },
      },
    });
  }
  structuredLog("telemetry_backend_error", {
    ...context,
    error: redactSecrets(error instanceof Error ? error.message : String(error)),
  });
}

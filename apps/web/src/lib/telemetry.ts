import * as Sentry from "@sentry/react";

type SafeBrowserEvent = {
  event: string;
  component?: string;
  operationId?: string;
  errorCode?: string;
};

export function initializeWebTelemetry() {
  // Deliberately excludes URL, user identity, form values and browser storage.
  if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      beforeSend(event) {
        delete event.request;
        delete event.user;
        return event;
      },
    });
  }
  if (import.meta.env.DEV) console.info(JSON.stringify({ event: "telemetry_web_initialized" }));
}

export function captureWebEvent(event: SafeBrowserEvent) {
  if (import.meta.env.VITE_SENTRY_DSN && event.errorCode) {
    Sentry.captureMessage(event.event, {
      level: "error",
      tags: {
        component: event.component,
        errorCode: event.errorCode,
      },
    });
  }
  if (import.meta.env.DEV) console.info(JSON.stringify(event));
}

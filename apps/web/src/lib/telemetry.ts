type SafeBrowserEvent = {
  event: string;
  component?: string;
  operationId?: string;
  errorCode?: string;
};

export function initializeWebTelemetry() {
  // Deliberately excludes URL, user identity, form values and browser storage.
  if (import.meta.env.DEV) console.info(JSON.stringify({ event: "telemetry_web_initialized" }));
}

export function captureWebEvent(event: SafeBrowserEvent) {
  if (import.meta.env.DEV) console.info(JSON.stringify(event));
}

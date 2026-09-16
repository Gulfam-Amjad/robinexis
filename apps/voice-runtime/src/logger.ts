const SENSITIVE_KEY = /secret|token|authorization|api[-_]?key|phone|email|transcript|input|result/i;

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactForLog(nested),
    ]),
  );
}

export function runtimeLog(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...redactForLog(fields) as object }));
}

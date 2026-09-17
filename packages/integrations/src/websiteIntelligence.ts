import { isIP } from "node:net";

export const WEBSITE_EXTRACTOR_VERSION = "firecrawl-receptionist-v1";
export interface WebsiteIntelligenceLimits {
  maxPages: number;
  maxDepth: number;
  maxContentChars: number;
  timeoutMs: number;
  retries: number;
}

export const WEBSITE_LIMITS: Readonly<WebsiteIntelligenceLimits> = Object.freeze({
  maxPages: 5,
  maxDepth: 3,
  maxContentChars: 250_000,
  timeoutMs: 120_000,
  retries: 2,
});

export const receptionistExtractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    businessName: { type: ["string", "null"] },
    locations: { type: "array", items: { type: "string" }, maxItems: 20 },
    contacts: {
      type: "object",
      additionalProperties: false,
      properties: {
        phones: { type: "array", items: { type: "string" }, maxItems: 20 },
        emails: { type: "array", items: { type: "string" }, maxItems: 20 },
      },
    },
    hours: { type: ["string", "null"] },
    timezone: { type: ["string", "null"] },
    services: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          durationMinutes: { type: ["number", "null"] },
          price: { type: ["string", "null"] },
        },
        required: ["name"],
      },
    },
    bookingRules: { type: "array", items: { type: "string" }, maxItems: 30 },
    cancellationRules: { type: "array", items: { type: "string" }, maxItems: 30 },
    faqs: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { question: { type: "string" }, answer: { type: "string" } },
        required: ["question", "answer"],
      },
    },
    transferEscalation: { type: "array", items: { type: "string" }, maxItems: 30 },
    transferDestination: { type: ["string", "null"] },
    recordingConsent: { type: ["string", "null"] },
    tone: { type: ["string", "null"] },
  },
  required: [
    "locations", "contacts", "services", "bookingRules", "cancellationRules",
    "faqs", "transferEscalation",
  ],
} as const;

export type WebsiteFactKey =
  | "businessName"
  | "locations"
  | "contacts"
  | "hours"
  | "timezone"
  | "services"
  | "bookingRules"
  | "cancellationRules"
  | "faqs"
  | "transferEscalation"
  | "transferDestination"
  | "recordingConsent"
  | "tone";

export interface NormalizedWebsiteFact {
  key: WebsiteFactKey;
  value: unknown;
  confidence: number;
  evidence: { url: string; excerpt?: string };
}

export interface ReceptionistGap {
  key:
    | "hours"
    | "timezone"
    | "service_duration"
    | "calendar_connection"
    | "transfer_destination"
    | "recording_consent";
  detail: string;
}

export interface FirecrawlWebsiteResult {
  canonicalUrl: string;
  markdown: string;
  facts: NormalizedWebsiteFact[];
  pages: number;
}

export interface FirecrawlWebsiteClientOptions {
  apiKey?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  limits?: Partial<WebsiteIntelligenceLimits>;
}

type FirecrawlPage = {
  markdown?: unknown;
  json?: unknown;
  metadata?: { sourceURL?: unknown; url?: unknown; statusCode?: unknown };
};

export function validatePublicWebsiteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("invalid_website_url");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("public_https_url_required");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    isIP(hostname) !== 0 ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".test") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".example")
  ) {
    throw new Error("public_hostname_required");
  }
  url.hostname = hostname;
  url.hash = "";
  return url;
}

function sameHostname(expected: URL, candidate: string): boolean {
  try {
    const parsed = validatePublicWebsiteUrl(candidate);
    return parsed.hostname === expected.hostname;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FirecrawlWebsiteClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly limits: WebsiteIntelligenceLimits;

  constructor(options: FirecrawlWebsiteClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? "";
    this.apiUrl = (options.apiUrl ?? process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev").replace(/\/+$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.limits = { ...WEBSITE_LIMITS, ...options.limits };
    if (!this.apiKey) throw new Error("firecrawl_not_configured");
  }

  async extract(input: string): Promise<FirecrawlWebsiteResult> {
    const url = validatePublicWebsiteUrl(input);
    const scrapeOptions = {
      formats: [
        "markdown",
        {
          type: "json",
          schema: receptionistExtractionSchema,
          prompt: "Extract only explicit receptionist-ready business facts. Do not infer missing values.",
        },
      ],
      onlyMainContent: true,
      maxAge: 0,
    };
    const started = await this.request<{ success?: boolean; id?: string }>("/v2/crawl", {
      method: "POST",
      body: JSON.stringify({
        url: url.toString(),
        limit: this.limits.maxPages,
        maxDiscoveryDepth: this.limits.maxDepth,
        allowSubdomains: false,
        ignoreQueryParameters: true,
        scrapeOptions,
      }),
    });
    if (!started.id) throw new Error("firecrawl_crawl_id_missing");

    const deadline = Date.now() + this.limits.timeoutMs;
    let result: { status?: string; data?: FirecrawlPage[]; error?: string };
    do {
      result = await this.request(`/v2/crawl/${encodeURIComponent(started.id)}`, { method: "GET" });
      if (result.status === "completed") break;
      if (result.status === "failed" || result.status === "cancelled") {
        throw new Error(`firecrawl_crawl_failed:${String(result.error || result.status)}`);
      }
      if (Date.now() >= deadline) throw new Error("firecrawl_timeout");
      await sleep(1_000);
    } while (true);

    let pages = (result.data ?? []).slice(0, this.limits.maxPages);
    if (!pages.length) {
      const fallback = await this.request<{ success?: boolean; data?: FirecrawlPage }>("/v2/scrape", {
        method: "POST",
        body: JSON.stringify({ url: url.toString(), ...scrapeOptions }),
      });
      pages = fallback.data ? [fallback.data] : [];
    }
    if (!pages.length) throw new Error("firecrawl_no_pages");
    const accepted = pages.map((page) => {
      const sourceUrl = String(page.metadata?.sourceURL || page.metadata?.url || "");
      if (!sameHostname(url, sourceUrl)) throw new Error("firecrawl_unsafe_redirect");
      return { ...page, sourceUrl };
    });
    const markdown = accepted
      .map((page) => String(page.markdown || ""))
      .join("\n\n")
      .slice(0, this.limits.maxContentChars);
    const facts = normalizeFirecrawlFacts(accepted);
    return { canonicalUrl: url.toString(), markdown, facts, pages: accepted.length };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.limits.retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.limits.timeoutMs);
      try {
        const response = await this.fetcher(`${this.apiUrl}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...init.headers,
          },
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) {
          const text = (await response.text()).slice(0, 500);
          if (response.status < 500 && response.status !== 429) {
            throw new Error(`firecrawl_http_${response.status}:${text}`);
          }
          lastError = new Error(`firecrawl_http_${response.status}:${text}`);
        } else {
          return await response.json() as T;
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("firecrawl_http_4") && !error.message.startsWith("firecrawl_http_429")) throw error;
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
      if (attempt < this.limits.retries) await sleep(20 * (2 ** attempt));
    }
    throw lastError instanceof Error ? lastError : new Error("firecrawl_request_failed");
  }
}

export function normalizeFirecrawlFacts(pages: Array<FirecrawlPage & { sourceUrl: string }>): NormalizedWebsiteFact[] {
  const byKey = new Map<WebsiteFactKey, NormalizedWebsiteFact>();
  for (const page of pages) {
    if (!page.json || typeof page.json !== "object" || Array.isArray(page.json)) continue;
    for (const [rawKey, value] of Object.entries(page.json as Record<string, unknown>)) {
      if (!isFactKey(rawKey) || isEmpty(value) || byKey.has(rawKey)) continue;
      const excerpt = evidenceExcerpt(String(page.markdown || ""), value);
      byKey.set(rawKey, {
        key: rawKey,
        value,
        confidence: excerpt ? 0.9 : 0.7,
        evidence: { url: page.sourceUrl, excerpt },
      });
    }
  }
  return [...byKey.values()];
}

export function analyzeReceptionistGaps(
  facts: ReadonlyArray<Pick<NormalizedWebsiteFact, "key" | "value">>,
  options: { calendarConnected: boolean },
): ReceptionistGap[] {
  const map = new Map(facts.map((fact) => [fact.key, fact.value]));
  const gaps: ReceptionistGap[] = [];
  if (isEmpty(map.get("hours"))) gaps.push({ key: "hours", detail: "Opening hours require confirmation." });
  if (isEmpty(map.get("timezone"))) gaps.push({ key: "timezone", detail: "Business timezone requires confirmation." });
  const services = Array.isArray(map.get("services")) ? map.get("services") as Array<Record<string, unknown>> : [];
  if (!services.length || services.some((service) => !positiveNumber(service.durationMinutes))) {
    gaps.push({ key: "service_duration", detail: "Every bookable service needs a duration." });
  }
  if (!options.calendarConnected) {
    gaps.push({ key: "calendar_connection", detail: "A calendar connection must be configured and verified." });
  }
  if (isEmpty(map.get("transferDestination"))) {
    gaps.push({ key: "transfer_destination", detail: "A human transfer destination requires confirmation." });
  }
  if (isEmpty(map.get("recordingConsent"))) {
    gaps.push({ key: "recording_consent", detail: "Call recording and consent wording requires confirmation." });
  }
  return gaps;
}

export function approvedWebsiteMarkdown(url: string, facts: NormalizedWebsiteFact[]): string {
  const lines = [`# Approved website facts`, "", `Source: ${url}`, ""];
  for (const fact of facts) {
    lines.push(`## ${fact.key}`, "", typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value, null, 2), "");
    lines.push(`Evidence: ${fact.evidence.url}${fact.evidence.excerpt ? ` — ${fact.evidence.excerpt}` : ""}`, "");
  }
  return lines.join("\n").slice(0, WEBSITE_LIMITS.maxContentChars);
}

function isFactKey(value: string): value is WebsiteFactKey {
  return [
    "businessName", "locations", "contacts", "hours", "timezone", "services",
    "bookingRules", "cancellationRules", "faqs", "transferEscalation",
    "transferDestination", "recordingConsent", "tone",
  ].includes(value);
}

function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function evidenceExcerpt(markdown: string, value: unknown): string | undefined {
  const needle = typeof value === "string"
    ? value
    : Array.isArray(value) && typeof value[0] === "string"
      ? value[0]
      : undefined;
  if (!needle) return undefined;
  const index = markdown.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return undefined;
  return markdown.slice(Math.max(0, index - 80), index + needle.length + 80).replace(/\s+/g, " ").trim().slice(0, 300);
}

import { describe, expect, it, vi } from "vitest";
import {
  FirecrawlWebsiteClient,
  analyzeReceptionistGaps,
  receptionistExtractionSchema,
  validatePublicWebsiteUrl,
} from "./websiteIntelligence.js";

describe("website intelligence", () => {
  it.each([
    "http://salon.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://service.internal",
    "https://example.com:8443",
    "https://user:pass@example.com",
  ])("rejects unsafe target %s", (target) => {
    expect(() => validatePublicWebsiteUrl(target)).toThrow();
  });

  it("uses a bounded structured same-domain Firecrawl crawl", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, id: "crawl_1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "completed",
        data: [{
          markdown: "# Acme Salon\nOpen Monday to Friday, 9–5.",
          json: {
            businessName: "Acme Salon",
            locations: ["1 High Street, London"],
            contacts: { phones: ["+442071234567"], emails: ["hello@acme-salon.com"] },
            hours: "Monday to Friday, 9–5",
            timezone: "Europe/London",
            services: [{ name: "Cut", durationMinutes: 30, price: "£35" }],
            bookingRules: ["Book online"],
            cancellationRules: ["24 hours notice"],
            faqs: [],
            transferEscalation: ["Transfer urgent requests"],
            transferDestination: "+442071234567",
            recordingConsent: "Tell callers calls may be recorded",
            tone: "Warm and professional",
          },
          metadata: { sourceURL: "https://acme-salon.com/services" },
        }],
      }), { status: 200 }));
    const client = new FirecrawlWebsiteClient({
      apiKey: "test-key",
      apiUrl: "https://firecrawl.test",
      fetch: fetcher,
      limits: { timeoutMs: 1_000, retries: 0 },
    });

    const result = await client.extract("https://acme-salon.com/");

    expect(result.pages).toBe(1);
    expect(result.facts.find((fact) => fact.key === "businessName")?.value).toBe("Acme Salon");
    const start = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(start).toMatchObject({
      url: "https://acme-salon.com/",
      limit: 20,
      maxDiscoveryDepth: 3,
      allowSubdomains: false,
      scrapeOptions: { onlyMainContent: true },
    });
    expect(start.scrapeOptions.formats[1].schema).toEqual(receptionistExtractionSchema);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("rejects cross-domain result pages as unsafe redirects", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "crawl_2" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "completed",
        data: [{ markdown: "redirected", json: {}, metadata: { sourceURL: "https://evil-company.com/" } }],
      }), { status: 200 }));
    const client = new FirecrawlWebsiteClient({
      apiKey: "test-key",
      fetch: fetcher,
      limits: { timeoutMs: 1_000, retries: 0 },
    });
    await expect(client.extract("https://acme-salon.com/")).rejects.toThrow("firecrawl_unsafe_redirect");
  });

  it("waits at least one second between Firecrawl status polls", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: "crawl_poll" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: "scraping" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          status: "completed",
          data: [{ markdown: "Acme", json: {}, metadata: { sourceURL: "https://acme-salon.com/" } }],
        }), { status: 200 }));
      const client = new FirecrawlWebsiteClient({
        apiKey: "test-key",
        fetch: fetcher,
        limits: { timeoutMs: 5_000, retries: 0 },
      });
      const extraction = client.extract("https://acme-salon.com/");
      await vi.advanceTimersByTimeAsync(999);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(extraction).resolves.toMatchObject({ pages: 1 });
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports every minimum receptionist readiness gap", () => {
    expect(analyzeReceptionistGaps([], { calendarConnected: false }).map((gap) => gap.key)).toEqual([
      "hours",
      "timezone",
      "service_duration",
      "calendar_connection",
      "transfer_destination",
      "recording_consent",
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { MemoryStore, robinexisDemoSeed, type OutboundJob } from "@robinexis/database";
import { processOutboundJobs } from "./outboundJobs.js";

const now = new Date("2026-09-18T10:00:00.000Z");

async function setup(suppressed = false) {
  const store = new MemoryStore();
  const client = robinexisDemoSeed();
  client.callingWindow = { tz: "UTC", startHour: 8, endHour: 21, skipSunday: true };
  client.outboundCallerId = "+441234567890";
  client.published = true;
  await store.upsertClient(client);
  const job: OutboundJob = {
    id: "job_1",
    clientId: client.id,
    campaign: "appointment-reminder",
    contactPhone: "+447700900123",
    purpose: "appointment reminder",
    scheduledAt: now.toISOString(),
    attemptCount: 0,
    maxAttempts: 2,
    status: "approved",
    approved: true,
  };
  await store.saveJob(job);
  if (suppressed) {
    await store.addSuppression({
      clientId: client.id,
      phone: job.contactPhone,
      reason: "customer request",
      createdAt: now.toISOString(),
    });
  }
  return { store, job };
}

describe("outbound worker", () => {
  it("claims and dials an approved compliant job with scoped callbacks", async () => {
    const { store, job } = await setup();
    const dial = vi.fn().mockResolvedValue({ sid: "CA_test" });
    const result = await processOutboundJobs({
      store,
      now,
      enabled: true,
      twimlUrl: "https://voice.example.com/outbound",
      statusCallbackBase: "https://api.example.com",
      dial,
    });
    expect(result.dialed).toBe(1);
    expect(dial).toHaveBeenCalledWith(expect.objectContaining({
      to: job.contactPhone,
      twimlUrl: expect.stringContaining(`jobId=${job.id}`),
      statusCallback: expect.stringContaining(`clientId=${job.clientId}`),
    }));
    expect((await store.getJob(job.id))?.status).toBe("dialing");
  });

  it("never dials a suppressed contact", async () => {
    const { store, job } = await setup(true);
    const dial = vi.fn();
    const result = await processOutboundJobs({
      store,
      now,
      enabled: true,
      twimlUrl: "https://voice.example.com/outbound",
      statusCallbackBase: "https://api.example.com",
      dial,
    });
    expect(result.suppressed).toBe(1);
    expect(dial).not.toHaveBeenCalled();
    expect((await store.getJob(job.id))?.status).toBe("suppressed");
  });

  it("retries provider failures and stops at max attempts", async () => {
    const { store, job } = await setup();
    const dial = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    await processOutboundJobs({
      store,
      now,
      enabled: true,
      twimlUrl: "https://voice.example.com/outbound",
      statusCallbackBase: "https://api.example.com",
      dial,
    });
    expect((await store.getJob(job.id))?.status).toBe("approved");
    const retryAt = new Date((await store.getJob(job.id))!.scheduledAt);
    await processOutboundJobs({
      store,
      now: retryAt,
      enabled: true,
      twimlUrl: "https://voice.example.com/outbound",
      statusCallbackBase: "https://api.example.com",
      dial,
    });
    expect((await store.getJob(job.id))?.status).toBe("failed");
  });
});

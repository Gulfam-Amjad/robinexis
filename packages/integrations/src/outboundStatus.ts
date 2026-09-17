import type { OutboundJob } from "@robinexis/database";

export function applyOutboundStatus(
  job: OutboundJob,
  input: { callStatus: string; answeredBy?: string },
  now = new Date(),
): OutboundJob {
  if (input.answeredBy?.startsWith("machine")) {
    job.status = "completed";
    job.disposition = "voicemail";
  } else if (input.callStatus === "completed") {
    job.status = "completed";
    job.disposition ??= "answered-completed";
  } else if (input.callStatus === "busy" || input.callStatus === "no-answer") {
    job.disposition = input.callStatus;
    if (job.attemptCount < job.maxAttempts) {
      job.status = "approved";
      job.scheduledAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    } else {
      job.status = "failed";
    }
  } else {
    job.status = "failed";
    job.disposition = "failed";
    job.lastError = input.callStatus;
  }
  return job;
}

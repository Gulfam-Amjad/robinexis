import { describe, expect, it } from "vitest";
import { scoreDecisions } from "../../../scripts/evaluate-cost-saver-models.js";
import {
  evaluateUkSalonScenario,
  UK_SALON_QUALITY_SCENARIOS,
} from "./fixtures/ukSalonScenarios.js";

describe("Cost Saver conversation quality scoring", () => {
  it("accepts concise, warm, factual receptionist replies", () => {
    const scored = scoreDecisions([
      {
        id: "faq_hours",
        nextAction: "answer_fact",
        spokenReply: "Of course — we're open weekdays from ten till seven.",
      },
      {
        id: "vague_request",
        nextAction: "ask_completion",
        spokenReply: "No problem. What would you like help with — a cut, colour, or something else?",
      },
      {
        id: "time_correction",
        nextAction: "accept_correction",
        spokenReply: "No worries, I've changed that to half four.",
      },
      {
        id: "frustrated_caller",
        nextAction: "acknowledge_and_help",
        spokenReply: "I'm sorry, I understand that's frustrating. Let's sort the haircut — which day suits you?",
      },
      {
        id: "human_request",
        nextAction: "transfer_to_human",
        spokenReply: "Of course, I'll put you through to someone at the salon.",
      },
    ]);

    expect(scored.passed).toEqual(expect.arrayContaining([
      "faq_hours:pass",
      "vague_request:pass",
      "time_correction:pass",
      "frustrated_caller:pass",
      "human_request:pass",
    ]));
  });

  it("rejects robotic wording, wrong facts, blame, and cold escalation", () => {
    const scored = scoreDecisions([
      {
        id: "faq_hours",
        nextAction: "answer_fact",
        spokenReply: "How may I assist you today?",
      },
      {
        id: "time_correction",
        nextAction: "accept_correction",
        spokenReply: "You said half three, which was wrong.",
      },
      {
        id: "frustrated_caller",
        nextAction: "acknowledge_and_help",
        spokenReply: "Please provide a date.",
      },
      {
        id: "human_request",
        nextAction: "transfer_to_human",
        spokenReply: "Wait.",
      },
    ]);

    expect(scored.failed.join("\n")).toMatch(/faq_hours:fail.*not_robotic.*correct_hours/);
    expect(scored.failed.join("\n")).toMatch(/time_correction:fail.*uses_correction.*no_blame/);
    expect(scored.failed.join("\n")).toMatch(/frustrated_caller:fail.*not_robotic.*acknowledges_feeling/);
    expect(scored.failed.join("\n")).toMatch(/human_request:fail.*warm_handoff/);
  });
});

describe("executable UK salon quality fixtures", () => {
  it.each(UK_SALON_QUALITY_SCENARIOS)("passes exact safe outcomes for $id", (scenario) => {
    expect(evaluateUkSalonScenario(scenario, {
      ...scenario.expected,
      interruptionObserved: scenario.audio.interruptionAtMs !== undefined,
      spokenReply: "Lovely, that appointment is booked for you.",
    })).toEqual({ passed: true, failed: [] });
  });

  it("blocks duplicate bookings, missed interruptions, and truncated speech", () => {
    const scenario = UK_SALON_QUALITY_SCENARIOS[2]!;
    expect(evaluateUkSalonScenario(scenario, {
      ...scenario.expected,
      bookingCount: 2,
      interruptionObserved: false,
      spokenReply: "Of course, I can check the",
    })).toEqual({
      passed: false,
      failed: ["single_booking", "spoken_reply", "interruption"],
    });
  });
});

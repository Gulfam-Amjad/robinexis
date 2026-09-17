export interface UkSalonQualityScenario {
  id: string;
  caller: { name: string; postcode: string };
  request: string;
  expected: {
    service: string;
    pricePence: number;
    startsAt: string;
    toolIdempotencyKey: string;
    bookingCount: 1;
  };
  audio: { noisy: boolean; interruptionAtMs?: number };
}

/** Provider-neutral, synthetic fixtures. No live numbers, credentials, or provider IDs. */
export const UK_SALON_QUALITY_SCENARIOS: readonly UkSalonQualityScenario[] = Object.freeze([
  {
    id: "cut-noisy-postcode",
    caller: { name: "Aisha Khan", postcode: "M1 1AE" },
    request: "Book a ladies cut with Priya at half past two on 22 September.",
    expected: {
      service: "ladies-cut",
      pricePence: 4_500,
      startsAt: "2026-09-22T14:30:00+01:00",
      toolIdempotencyKey: "quality:cut-noisy-postcode:2026-09-22T14:30+01:00",
      bookingCount: 1,
    },
    audio: { noisy: true },
  },
  {
    id: "colour-interrupted",
    caller: { name: "Siobhan O'Neill", postcode: "SW1A 1AA" },
    request: "Book a full-head colour with Maeve at 10am on 24 September; interrupt while the agent confirms.",
    expected: {
      service: "full-head-colour",
      pricePence: 9_500,
      startsAt: "2026-09-24T10:00:00+01:00",
      toolIdempotencyKey: "quality:colour-interrupted:2026-09-24T10:00+01:00",
      bookingCount: 1,
    },
    audio: { noisy: false, interruptionAtMs: 1_200 },
  },
  {
    id: "fade-noisy-interrupted-idempotent",
    caller: { name: "Rhys Davies", postcode: "CF10 1EP" },
    request: "Book a skin fade with Tom at quarter past five on 25 September, with background salon noise and one interruption.",
    expected: {
      service: "skin-fade",
      pricePence: 2_800,
      startsAt: "2026-09-25T17:15:00+01:00",
      toolIdempotencyKey: "quality:fade-noisy-interrupted-idempotent:2026-09-25T17:15+01:00",
      bookingCount: 1,
    },
    audio: { noisy: true, interruptionAtMs: 900 },
  },
]);

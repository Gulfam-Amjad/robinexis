# UK salon quality benchmark

Use `UK_SALON_QUALITY_SCENARIOS` from `src/fixtures/ukSalonScenarios.ts` against
both providers with the same published tenant configuration. These are synthetic
tests only; do not attach a live phone number.

For every scenario:

1. Use Europe/London time and preserve the fixture's UK local offset.
2. Verify the spoken service, price, staff name, caller name and postcode.
3. Add the specified noise profile and interrupt at `interruptionAtMs` when set.
4. Call the booking tool twice with the same `toolIdempotencyKey`.
5. Assert both responses identify the same booking and exactly one booking exists.
6. Record booking outcome, cost, first-response latency, failed-call outcome and
   blind voice preference in the typed benchmark contract.

The launch gate is evidence storage and calculation only. It must never dispatch,
provision, attach a number or modify provider routing.

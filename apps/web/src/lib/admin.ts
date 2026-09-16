import type { ClientSummary } from "@robinexis/api-contracts";

export function filterClients(clients: ClientSummary[], search: string): ClientSummary[] {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return clients;
  return clients.filter((client) =>
    [client.businessName, client.slug, client.id, client.serviceStatus, client.onboardingStatus]
      .some((value) => value?.toLocaleLowerCase().includes(term)),
  );
}

export function validateCreditAdjustment(minutesInput: string, reasonInput: string) {
  const minutes = Number(minutesInput);
  const reason = reasonInput.trim();
  return {
    minutes,
    reason,
    minutesError: !Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes === 0
      ? "Enter a non-zero whole number of minutes."
      : undefined,
    reasonError: reason.length < 3 ? "Enter an audit reason of at least 3 characters." : undefined,
  };
}

export function validateServiceAction(reasonInput: string, confirmationInput: string, customerName: string) {
  const reason = reasonInput.trim();
  const expectedConfirmation = `CONFIRM ${customerName}`;
  return {
    reason,
    expectedConfirmation,
    reasonError: reason.length < 5 ? "Enter an audit reason of at least 5 characters." : undefined,
    confirmationError: confirmationInput !== expectedConfirmation
      ? `Type ${expectedConfirmation} to continue.`
      : undefined,
  };
}

/** In-app allowance warning: 10% of included minutes, never below 30. */
export function lowBalanceThresholdMinutes(includedMinutes = 300): number {
  return Math.max(30, includedMinutes * 0.1);
}

export function shouldWarnLowBalance(remainingMinutes: number, includedMinutes = 300): boolean {
  return remainingMinutes <= lowBalanceThresholdMinutes(includedMinutes);
}

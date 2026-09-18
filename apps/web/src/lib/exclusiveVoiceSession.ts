export type VoiceProvider = "premium" | "cost-saver";

/**
 * Synchronous ownership guard for browser audio. React state alone is not
 * sufficient because two clicks can occur before the next render.
 */
export class ExclusiveVoiceSession {
  private owner: VoiceProvider | null = null;

  acquire(provider: VoiceProvider): boolean {
    if (this.owner && this.owner !== provider) return false;
    this.owner = provider;
    return true;
  }

  release(provider: VoiceProvider): boolean {
    if (this.owner !== provider) return false;
    this.owner = null;
    return true;
  }

  current(): VoiceProvider | null {
    return this.owner;
  }
}

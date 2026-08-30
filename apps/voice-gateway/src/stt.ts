export interface SttSessionHandlers {
  onUtterance: (text: string) => void;
  onSpeechStarted?: () => void;
  onSpeechEnded?: (info: { audioMs: number }) => void;
  onTranscriptionComplete?: (info: { durationMs: number; textLength: number }) => void;
  onError?: (err: unknown) => void;
}

export interface SttSession {
  sendAudio: (chunk: Buffer) => void;
  close: () => void;
}

export type SttFactory = (handlers: SttSessionHandlers) => SttSession;

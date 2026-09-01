export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizeE164(phone: string): string {
  return phone.replace(/[\s()-]/g, "");
}

export function isValidE164(phone: string): boolean {
  return E164_PATTERN.test(normalizeE164(phone));
}

/** Twilio / sandbox placeholders that look like E.164 but must never be Dialled. */
export const NON_DIALABLE_E164 = new Set(["+15555550100", "+15555550199"]);

const DIGITS = /\D/g;

const SPOKEN_TOKEN: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  plus: "+",
};

export function digitsOnly(value: string): string {
  return value.replace(DIGITS, "");
}

function expandSpokenDigits(raw: string): string {
  return raw.replace(/[A-Za-z]+/g, (word) => SPOKEN_TOKEN[word.toLowerCase()] ?? word);
}

/**
 * Spoken or national numbers → E.164 when the country is obvious.
 * UK 07/01/02… and Pakistan 03… are the demo paths.
 */
export function normalizeSpokenPhone(raw: string): string {
  const trimmed = normalizeE164(expandSpokenDigits(raw).trim());
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;

  const digits = digitsOnly(trimmed);
  if (digits.startsWith("44") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("92") && digits.length >= 11) return `+${digits}`;
  if (digits.startsWith("07") && digits.length >= 10) return `+44${digits.slice(1)}`;
  if (digits.startsWith("03") && digits.length >= 10) return `+92${digits.slice(1)}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+44${digits.slice(1)}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return trimmed.startsWith("+") ? trimmed : digits ? `+${digits}` : "";
}

export function toDialableE164(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const normalized = normalizeSpokenPhone(raw);
  if (!isValidE164(normalized)) return undefined;
  if (NON_DIALABLE_E164.has(normalized)) return undefined;
  return normalized;
}

export function guestEmailFromPhone(phone: string): string {
  const digits = digitsOnly(phone) || "unknown";
  const host = (process.env.CALCOM_CHECK_EMAIL || "").trim();
  if (host.includes("@")) {
    const [local, domain] = host.split("@");
    return `${local}+${digits}@${domain}`;
  }
  return `guest+${digits}@book.robinexis.test`;
}

export function isDialableE164(value: string | undefined): boolean {
  return Boolean(toDialableE164(value));
}


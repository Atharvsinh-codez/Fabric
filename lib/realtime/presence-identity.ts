export const PRESENCE_COLORS = [
  "#0284c7",
  "#7c3aed",
  "#059669",
  "#db2777",
  "#ea580c",
] as const;

export const PRESENCE_FALLBACK_LABEL = "Fabric member";
export const PRESENCE_UNVERIFIED_LABEL = "Collaborator";
export const PRESENCE_UNVERIFIED_COLOR = "#64748b";

const PRESENCE_LABEL_CODE_POINT_LIMIT = 64;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;
const BIDI_CONTROL_CHARACTERS = /[\u202a-\u202e\u2066-\u2069]/gu;

export type PresenceColor = (typeof PRESENCE_COLORS)[number];

export type PresencePresentation = Readonly<{
  authoritative: boolean;
  color: string;
  initials: string;
  label: string;
}>;

type PresenceIdentityCandidate = Readonly<{
  avatarColor?: unknown;
  clientInstanceId?: unknown;
  displayLabel?: unknown;
  principalId?: unknown;
  serverAuthoritative?: unknown;
}>;

export function sanitizePresenceDisplayLabel(value: unknown): string {
  if (typeof value !== "string") return PRESENCE_FALLBACK_LABEL;
  const normalized = value
    .normalize("NFC")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(BIDI_CONTROL_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .trim();
  const truncated = Array.from(normalized)
    .slice(0, PRESENCE_LABEL_CODE_POINT_LIMIT)
    .join("")
    .trim();
  return truncated || PRESENCE_FALLBACK_LABEL;
}

export function authoritativePresenceColor(principalId: string): PresenceColor {
  let hash = 2_166_136_261;
  for (const character of principalId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]!;
}

export function isPresenceColor(value: unknown): value is PresenceColor {
  return (
    typeof value === "string" &&
    (PRESENCE_COLORS as readonly string[]).includes(value)
  );
}

export function presenceInitials(label: string): string {
  const words = label.split(/\s+/u).filter(Boolean);
  const selected = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  const initials = selected
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
  return initials || "?";
}

/**
 * Identity fields are trusted only after EphemeralAwareness marks a state that
 * passed the server-bound remote schema. Local awareness can never set this
 * marker, so client-supplied names and colors stay presentation-inert.
 */
export function resolvePresencePresentation(
  state: PresenceIdentityCandidate,
): PresencePresentation {
  const authoritative =
    state.serverAuthoritative === true &&
    typeof state.principalId === "string" &&
    UUID_PATTERN.test(state.principalId) &&
    typeof state.clientInstanceId === "string" &&
    UUID_PATTERN.test(state.clientInstanceId) &&
    isPresenceColor(state.avatarColor);

  const label = authoritative
    ? sanitizePresenceDisplayLabel(state.displayLabel)
    : PRESENCE_UNVERIFIED_LABEL;
  const color = authoritative
    ? (state.avatarColor as PresenceColor)
    : PRESENCE_UNVERIFIED_COLOR;
  return {
    authoritative,
    color,
    initials: presenceInitials(label),
    label,
  };
}

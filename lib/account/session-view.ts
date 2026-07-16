export type StoredAccountSession = Readonly<{
  id: string;
  sessionToken: string;
  expires: Date;
  createdAt: Date | null;
  lastSeenAt: Date | null;
  deviceLabel: string | null;
  userAgentFamily: string | null;
}>;

export type AccountSessionView = Readonly<{
  id: string;
  deviceLabel: string;
  current: boolean;
  createdAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string;
}>;

export type AccountSessionList = Readonly<{
  sessions: AccountSessionView[];
  currentSessionVerified: boolean;
}>;

function safeDeviceLabel(session: StoredAccountSession): string {
  const label = session.deviceLabel?.trim() || session.userAgentFamily?.trim();
  return label ? label.slice(0, 80) : "Web browser";
}

export function findCurrentSessionId(
  sessions: readonly Pick<StoredAccountSession, "id" | "sessionToken">[],
  tokenCandidates: readonly string[],
): string | null {
  for (const token of tokenCandidates) {
    const matchingSession = sessions.find((session) => session.sessionToken === token);
    if (matchingSession) return matchingSession.id;
  }

  return null;
}

export function buildAccountSessionList(
  sessions: readonly StoredAccountSession[],
  tokenCandidates: readonly string[],
): AccountSessionList {
  const currentSessionId = findCurrentSessionId(sessions, tokenCandidates);

  return {
    currentSessionVerified: currentSessionId !== null,
    sessions: sessions.map((session) => ({
      id: session.id,
      deviceLabel: safeDeviceLabel(session),
      current: session.id === currentSessionId,
      createdAt: session.createdAt?.toISOString() ?? null,
      lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
      expiresAt: session.expires.toISOString(),
    })),
  };
}

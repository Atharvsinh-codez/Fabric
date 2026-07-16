import type { AccountSessionList, AccountSessionView } from "@/lib/account/session-view";

export type AccountSession = AccountSessionView;

export class AccountSessionsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AccountSessionsApiError";
  }
}

async function readApiError(response: Response, fallback: string): Promise<AccountSessionsApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const error =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? body.error
      : null;
  const code = error && "code" in error && typeof error.code === "string" ? error.code : "request_failed";
  const message =
    error && "message" in error && typeof error.message === "string" ? error.message : fallback;

  return new AccountSessionsApiError(message, response.status, code);
}

export async function listAccountSessions(signal?: AbortSignal): Promise<AccountSessionList> {
  const response = await fetch("/api/account/sessions", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw await readApiError(response, "Sessions could not be loaded. Refresh the page and try again.");
  }

  return response.json() as Promise<AccountSessionList>;
}

export async function revokeAccountSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/account/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw await readApiError(response, "The session was not revoked. Refresh the list and try again.");
  }
}

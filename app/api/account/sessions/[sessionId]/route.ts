import type { NextRequest } from "next/server";

import { getAuthSessionTokenCandidates } from "@/lib/account/session-cookies";
import { isSameOriginMutation, parseOpaqueSessionId } from "@/lib/account/session-security";
import { revokeOtherAccountSession } from "@/lib/account/session-store";
import {
  AccountSuspendedError,
  AuthenticationRequiredError,
  requirePrincipal,
} from "@/lib/auth/require-principal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
  Vary: "Cookie",
};

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: noStoreHeaders });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  if (!isSameOriginMutation(request.url, request.headers.get("origin"))) {
    return jsonError(403, "forbidden_origin", "This request origin is not allowed.");
  }

  const { sessionId: rawSessionId } = await context.params;
  const sessionId = parseOpaqueSessionId(rawSessionId);
  if (!sessionId) {
    return jsonError(400, "invalid_session", "Choose a valid signed-in session.");
  }

  try {
    const principal = await requirePrincipal();
    const tokenCandidates = getAuthSessionTokenCandidates(
      request.cookies.getAll().map(({ name, value }) => ({ name, value })),
      request.nextUrl.protocol === "https:",
    );
    const result = await revokeOtherAccountSession(principal.id, sessionId, tokenCandidates);

    if (result === "not_found") {
      return jsonError(404, "session_not_found", "That session no longer exists for this account.");
    }
    if (result === "current_session") {
      return jsonError(409, "current_session", "Use Sign Out to end the current session.");
    }
    if (result === "current_session_unverified") {
      return jsonError(
        409,
        "current_session_unverified",
        "This browser could not be verified. Sign out and back in before revoking sessions.",
      );
    }

    return Response.json({ revokedSessionId: sessionId }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return jsonError(401, "unauthorized", "Sign in to manage account sessions.");
    }
    if (error instanceof AccountSuspendedError) {
      return jsonError(403, "account_suspended", "This account cannot manage sessions.");
    }

    return jsonError(
      500,
      "session_revoke_failed",
      "The session was not revoked. Refresh the list and try again.",
    );
  }
}

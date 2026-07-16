import type { NextRequest } from "next/server";

import { getAuthSessionTokenCandidates } from "@/lib/account/session-cookies";
import { listAccountSessions } from "@/lib/account/session-store";
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

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    const tokenCandidates = getAuthSessionTokenCandidates(
      request.cookies.getAll().map(({ name, value }) => ({ name, value })),
      request.nextUrl.protocol === "https:",
    );
    const result = await listAccountSessions(principal.id, tokenCandidates);

    return Response.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return jsonError(401, "unauthorized", "Sign in to view account sessions.");
    }
    if (error instanceof AccountSuspendedError) {
      return jsonError(403, "account_suspended", "This account cannot manage sessions.");
    }

    return jsonError(
      500,
      "sessions_unavailable",
      "Sessions could not be loaded. Refresh the page and try again.",
    );
  }
}

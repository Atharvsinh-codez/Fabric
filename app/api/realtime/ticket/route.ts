import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/clients/web";
import { boards } from "@/db/schema/product";
import { requirePrincipal } from "@/lib/auth/require-principal";
import { resolveBoardAccess } from "@/lib/boards/access";
import {
  apiJson,
  BoardApiError,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { roleCan } from "@/lib/boards/permissions";
import { getRealtimeIssuerEnvironment } from "@/lib/realtime/env";
import { isAllowedOrigin } from "@/lib/realtime/origin";
import { consumeRealtimeTicketMint } from "@/lib/realtime/rate-limit";
import { mintRealtimeTicket } from "@/lib/realtime/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ boardId: z.string().uuid() }).strict();

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const realtimeEnvironment = getRealtimeIssuerEnvironment();
    if (!isAllowedOrigin(request.headers.get("origin"), realtimeEnvironment.allowedOrigins)) {
      throw new BoardApiError(403, "forbidden_origin", "This request origin is not allowed.");
    }

    const principal = await requirePrincipal();
    const parsed = requestSchema.safeParse(await readJsonBody(request, 1024));
    if (!parsed.success) throw invalidRequest();

    const access = await resolveBoardAccess(principal.id, parsed.data.boardId);
    if (!access || access.archivedAt) {
      throw new BoardApiError(404, "not_found", "The requested resource was not found.");
    }
    const [board] = await db
      .select({
        id: boards.id,
        workspaceId: boards.workspaceId,
        documentGenerationId: boards.documentGenerationId,
      })
      .from(boards)
      .where(
        and(
          eq(boards.id, parsed.data.boardId),
          eq(boards.workspaceId, access.workspaceId),
          isNull(boards.archivedAt),
        ),
      )
      .limit(1);
    if (!board) {
      throw new BoardApiError(404, "not_found", "The requested resource was not found.");
    }

    const rateLimit = await consumeRealtimeTicketMint({
      principalId: principal.id,
      boardId: board.id,
    });
    if (!rateLimit.allowed) {
      return apiJson(
        {
          error: {
            code: "rate_limited",
            message: "Wait briefly before requesting another realtime ticket.",
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    const capabilities = roleCan(access.role, "edit_board")
      ? (["read", "write", "awareness"] as const)
      : (["read", "awareness"] as const);
    const minted = await mintRealtimeTicket(
      {
        subject: principal.id,
        workspaceId: board.workspaceId,
        boardId: board.id,
        documentGenerationId: board.documentGenerationId,
        displayLabel: principal.name,
        capabilities: [...capabilities],
      },
      {
        key: realtimeEnvironment.signingKey,
        issuer: realtimeEnvironment.issuer,
        audience: realtimeEnvironment.audience,
      },
    );

    return apiJson({
      protocolVersion: minted.claims.protocolVersion,
      ticket: minted.ticket,
      expiresAt: new Date(minted.claims.exp * 1000).toISOString(),
      boardId: minted.claims.boardId,
      documentGenerationId: minted.claims.documentGenerationId,
      capabilities: minted.claims.capabilities,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

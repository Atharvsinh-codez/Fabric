import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { boards, type BoardDocument } from "@/db/schema/product";
import { requireBoardCapability } from "@/lib/boards/authorization";
import { BoardApiError } from "@/lib/boards/http";

export type BoardPreviewMetadata = Readonly<{
  boardId: string;
  workspaceId: string;
  documentGenerationId: string;
  revision: number;
}>;

export type BoardPreviewSource = BoardPreviewMetadata &
  Readonly<{
    document: BoardDocument;
  }>;

/**
 * Resolves access before reading the lightweight version metadata used for
 * conditional thumbnail requests. The board document is deliberately omitted
 * so a matching ETag never loads the large JSON value.
 */
export async function getBoardPreviewMetadata(
  userId: string,
  boardId: string,
): Promise<BoardPreviewMetadata> {
  const { workspaceId } = await requireBoardCapability(userId, boardId, "view");
  const [metadata] = await db
    .select({
      boardId: boards.id,
      workspaceId: boards.workspaceId,
      documentGenerationId: boards.documentGenerationId,
      revision: boards.revision,
    })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  if (!metadata) {
    throw new BoardApiError(
      404,
      "not_found",
      "The requested resource was not found.",
    );
  }

  return metadata;
}

/**
 * Loads the full document only after the caller has completed the authorized
 * metadata/ETag check. Tenant scope comes exclusively from that result.
 */
export async function getBoardPreviewSource(
  metadata: BoardPreviewMetadata,
): Promise<BoardPreviewSource> {
  const [source] = await db
    .select({
      boardId: boards.id,
      workspaceId: boards.workspaceId,
      document: boards.document,
      documentGenerationId: boards.documentGenerationId,
      revision: boards.revision,
    })
    .from(boards)
    .where(
      and(
        eq(boards.id, metadata.boardId),
        eq(boards.workspaceId, metadata.workspaceId),
      ),
    )
    .limit(1);

  if (!source) {
    throw new BoardApiError(
      404,
      "not_found",
      "The requested resource was not found.",
    );
  }

  return source;
}

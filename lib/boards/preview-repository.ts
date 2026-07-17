import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { boards, type BoardDocument } from "@/db/schema/product";
import { requireBoardCapability } from "@/lib/boards/authorization";
import { BoardApiError } from "@/lib/boards/http";

export type BoardPreviewSource = Readonly<{
  boardId: string;
  workspaceId: string;
  document: BoardDocument;
  documentGenerationId: string;
  revision: number;
}>;

/**
 * Loads only the durable state needed to render a board thumbnail. Access is
 * resolved before the document is selected, and the second query is pinned to
 * the resolver's workspace so a caller can never choose tenant scope.
 */
export async function getBoardPreviewSource(
  userId: string,
  boardId: string,
): Promise<BoardPreviewSource> {
  const { workspaceId } = await requireBoardCapability(userId, boardId, "view");
  const [source] = await db
    .select({
      boardId: boards.id,
      workspaceId: boards.workspaceId,
      document: boards.document,
      documentGenerationId: boards.documentGenerationId,
      revision: boards.revision,
    })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)))
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

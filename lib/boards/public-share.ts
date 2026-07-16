import "server-only";

import { createHash } from "node:crypto";

import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/clients/web";
import { boardShareLinks, boards, workspaces } from "@/db/schema/product";
import {
  readTldrawDocument,
  type FabricTldrawDocument,
} from "@/lib/boards/tldraw-document";

const ShareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const SafeColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional();

const SharedNodeSchema = z.object({
  id: z.string().min(1).max(256),
  type: z.enum(["frame", "note", "text", "rectangle", "ellipse", "image", "summary"]),
  title: z.string().max(500).default("Untitled"),
  body: z.string().max(8_000).optional(),
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.number().finite().min(24).max(10_000),
  height: z.number().finite().min(24).max(10_000),
  fill: SafeColorSchema.default("#ffffff"),
  textColor: SafeColorSchema,
  tag: z.string().max(120).optional(),
});

const SharedEdgeSchema = z.object({
  id: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(256),
  targetId: z.string().min(1).max(256),
  route: z.enum(["straight", "elbow"]),
});

const SharedDocumentSchema = z.object({
  nodes: z.array(SharedNodeSchema).max(2_000).default([]),
  edges: z.array(SharedEdgeSchema).max(4_000).default([]),
});

export type PublicSharedNode = z.infer<typeof SharedNodeSchema>;
export type PublicSharedEdge = z.infer<typeof SharedEdgeSchema>;

export type PublicBoardShare = Readonly<{
  token: string;
  boardId: string;
  title: string;
  workspaceName: string;
  permission: "viewer" | "commenter";
  expiresAt: Date | null;
  revision: number;
  nodes: PublicSharedNode[];
  edges: PublicSharedEdge[];
  tldraw: FabricTldrawDocument | null;
}>;

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function resolvePublicBoardShare(token: string): Promise<PublicBoardShare | null> {
  const parsedToken = ShareTokenSchema.safeParse(token);
  if (!parsedToken.success) return null;

  const now = new Date();
  const [result] = await db
    .select({
      linkId: boardShareLinks.id,
      boardId: boards.id,
      title: boards.title,
      workspaceName: workspaces.name,
      permission: boardShareLinks.permission,
      expiresAt: boardShareLinks.expiresAt,
      lastUsedAt: boardShareLinks.lastUsedAt,
      revision: boards.revision,
      document: boards.document,
    })
    .from(boardShareLinks)
    .innerJoin(boards, eq(boards.id, boardShareLinks.boardId))
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .where(
      and(
        eq(boardShareLinks.tokenHash, hashShareToken(parsedToken.data)),
        isNull(boardShareLinks.revokedAt),
        isNull(boards.archivedAt),
        or(isNull(boardShareLinks.expiresAt), gt(boardShareLinks.expiresAt, now)),
      ),
    )
    .limit(1);

  if (!result) return null;

  const document = SharedDocumentSchema.safeParse(result.document);
  if (!document.success) return null;

  if (!result.lastUsedAt || result.lastUsedAt < new Date(now.getTime() - 5 * 60 * 1_000)) {
    await db
      .update(boardShareLinks)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(boardShareLinks.id, result.linkId),
          or(
            isNull(boardShareLinks.lastUsedAt),
            lt(boardShareLinks.lastUsedAt, new Date(now.getTime() - 5 * 60 * 1_000)),
          ),
        ),
      );
  }

  return {
    token: parsedToken.data,
    boardId: result.boardId,
    title: result.title,
    workspaceName: result.workspaceName,
    permission: result.permission,
    expiresAt: result.expiresAt,
    revision: result.revision,
    nodes: document.data.nodes,
    edges: document.data.edges,
    tldraw: readTldrawDocument(result.document),
  };
}

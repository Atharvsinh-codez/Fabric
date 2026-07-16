import { z } from "zod";

import type { CanvasPatch } from "./canvas-patch";
import type { CanvasDocumentSnapshot } from "../boards/canvas-document";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const AiProposalApprovalRequestSchema = z
  .object({
    runId: z.string().uuid(),
    patchHash: Sha256Schema,
    documentGenerationId: z.string().uuid(),
    baseDurableSequence: z.number().int().nonnegative().safe(),
    observedDurableSequence: z.number().int().positive().safe(),
  })
  .strict();

export type AiProposalApprovalRequest = z.infer<
  typeof AiProposalApprovalRequestSchema
>;

export const AiProposalApprovalResultSchema = z
  .object({
    run: z
      .object({
        id: z.string().uuid(),
        status: z.literal("completed"),
        boardId: z.string().uuid(),
        documentGenerationId: z.string().uuid(),
        baseDurableSequence: z.number().int().nonnegative().safe(),
        appliedDurableSequence: z.number().int().positive().safe(),
        finalizedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export type AiProposalApprovalResult = z.infer<
  typeof AiProposalApprovalResultSchema
>;

export type ApprovalProjectionIssueCode =
  | "missing_created_node"
  | "created_node_mismatch"
  | "missing_target_node"
  | "updated_node_mismatch"
  | "moved_node_mismatch"
  | "resized_node_mismatch"
  | "node_not_deleted"
  | "missing_connector"
  | "connector_mismatch";

export type ApprovalProjectionVerification =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; issueCodes: readonly ApprovalProjectionIssueCode[] }>;

const FILL_VALUES: Record<string, ReadonlySet<string>> = {
  surface: new Set(["#ffffff"]),
  ink: new Set(["#111827", "#1e2430"]),
  sky: new Set(["#0284c7", "#dce8ff"]),
  mint: new Set(["#16a34a", "#d9f1e6"]),
  butter: new Set(["#facc15", "#ffedb7"]),
  lavender: new Set(["#7c3aed", "#f0ddff"]),
  rose: new Set(["#dc2626", "#ffe1df"]),
  fog: new Set(["#64748b", "#eef3f8"]),
};

const TEXT_VALUES: Record<string, ReadonlySet<string>> = {
  ink: new Set(["#111827", "#22231f"]),
  surface: new Set(["#ffffff"]),
  muted: new Set(["#64748b", "#7a7d85"]),
};

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.05;
}

function resolvedId(id: string | undefined | null): string | undefined {
  return id === null || id === undefined ? undefined : id;
}

function appearanceMatches(
  node: CanvasDocumentSnapshot["nodes"][number],
  appearance: { fill?: string; textColor?: string } | undefined,
): boolean {
  if (!appearance) return true;
  if (appearance.fill && !FILL_VALUES[appearance.fill]?.has(node.fill.toLowerCase())) {
    return false;
  }
  if (
    appearance.textColor &&
    (!node.textColor ||
      !TEXT_VALUES[appearance.textColor]?.has(node.textColor.toLowerCase()))
  ) {
    return false;
  }
  return true;
}

/**
 * Verifies only the persisted semantic projection. A tldraw implementation must
 * preserve proposal temporary ids in Fabric metadata so created nodes and
 * connectors remain auditably identifiable after serialization.
 */
export function verifyApprovedPatchProjection(
  patch: CanvasPatch,
  document: Pick<CanvasDocumentSnapshot, "nodes" | "edges">,
): ApprovalProjectionVerification {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const edges = new Map(document.edges.map((edge) => [edge.id, edge]));
  const issues = new Set<ApprovalProjectionIssueCode>();

  for (const operation of patch.operations) {
    if (operation.type === "createNode") {
      const node = nodes.get(operation.tempId);
      if (!node) {
        issues.add("missing_created_node");
        continue;
      }
      const matches =
        node.type === operation.nodeType &&
        node.title === operation.content.title &&
        (node.body ?? undefined) === (operation.content.body ?? undefined) &&
        (node.tag ?? undefined) === (operation.content.tag ?? undefined) &&
        (node.meta ?? undefined) === (operation.content.meta ?? undefined) &&
        sameNumber(node.x, operation.position.x) &&
        sameNumber(node.y, operation.position.y) &&
        sameNumber(node.width, operation.size.width) &&
        sameNumber(node.height, operation.size.height) &&
        resolvedId(node.parentId) === resolvedId(operation.parentId) &&
        appearanceMatches(node, operation.appearance);
      if (!matches) issues.add("created_node_mismatch");
      continue;
    }

    if (operation.type === "createConnector") {
      const edge = edges.get(operation.tempId);
      if (!edge) {
        issues.add("missing_connector");
        continue;
      }
      if (
        edge.sourceId !== operation.sourceId ||
        edge.targetId !== operation.targetId ||
        edge.route !== operation.route
      ) {
        issues.add("connector_mismatch");
      }
      continue;
    }

    const node = nodes.get(operation.nodeId);
    if (operation.type === "deleteNode") {
      if (node) issues.add("node_not_deleted");
      continue;
    }
    if (!node) {
      issues.add("missing_target_node");
      continue;
    }

    if (operation.type === "moveNode") {
      const positionMatches =
        sameNumber(node.x, operation.position.x) &&
        sameNumber(node.y, operation.position.y);
      const parentMatches =
        operation.parentId === undefined ||
        resolvedId(node.parentId) === resolvedId(operation.parentId);
      if (!positionMatches || !parentMatches) issues.add("moved_node_mismatch");
    } else if (operation.type === "resizeNode") {
      if (
        !sameNumber(node.width, operation.size.width) ||
        !sameNumber(node.height, operation.size.height)
      ) {
        issues.add("resized_node_mismatch");
      }
    } else if (operation.type === "updateNode") {
      const content = operation.content;
      const matches =
        (!content?.title || node.title === content.title) &&
        (content?.body === undefined || (node.body ?? undefined) === content.body) &&
        (content?.tag === undefined || (node.tag ?? undefined) === content.tag) &&
        (content?.meta === undefined || (node.meta ?? undefined) === content.meta) &&
        appearanceMatches(node, operation.appearance);
      if (!matches) issues.add("updated_node_mismatch");
    }
  }

  return issues.size === 0
    ? { ok: true }
    : { ok: false, issueCodes: [...issues].sort() };
}

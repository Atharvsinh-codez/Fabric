import { z } from "zod";

import {
  CanvasIdentifierSchema,
  CanvasNodeTypeSchema,
  CanvasSourceGeometrySchema,
} from "./canvas-patch";
import { AuthorizedBoardSceneSchema } from "./engine/authorized-scene";

const SnapshotCoordinateSchema = z.number().finite().min(-100_000).max(100_000);
const SnapshotDimensionSchema = z.number().finite().min(1).max(10_000);

export const ProposalNodeSnapshotSchema = z
  .object({
    id: CanvasIdentifierSchema,
    type: CanvasNodeTypeSchema,
    title: z.string().trim().min(1).max(200),
    body: z.string().max(4_000).optional(),
    x: SnapshotCoordinateSchema,
    y: SnapshotCoordinateSchema,
    width: SnapshotDimensionSchema,
    height: SnapshotDimensionSchema,
    locked: z.boolean().optional(),
    parentId: CanvasIdentifierSchema.optional(),
    tag: z.string().trim().min(1).max(64).optional(),
    source: CanvasSourceGeometrySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source && value.type !== "drawing") {
      context.addIssue({
        code: "custom",
        message: "Vector source geometry is only valid for drawing snapshots",
        path: ["source"],
      });
    }
  });

export const AiProposalRequestSchema = z
  .object({
    skill: z.literal("canvas-agent").default("canvas-agent"),
    workspaceId: CanvasIdentifierSchema,
    boardId: CanvasIdentifierSchema,
    documentGenerationId: CanvasIdentifierSchema,
    durableSequence: z.number().int().nonnegative().safe(),
    instruction: z.string().trim().min(1).max(2_000),
    selection: z.array(ProposalNodeSnapshotSchema).max(40),
    viewport: z
      .object({
        x: SnapshotCoordinateSchema,
        y: SnapshotCoordinateSchema,
        width: SnapshotDimensionSchema,
        height: SnapshotDimensionSchema,
      })
      .strict(),
    conversation: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    /**
     * Populated exclusively from the durable board by the proposal route.
     * Any browser-supplied value is replaced during authorization.
     */
    scene: AuthorizedBoardSceneSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const identifiers = new Set<string>();
    let sourcePointCount = 0;
    value.selection.forEach((node, index) => {
      if (identifiers.has(node.id)) {
        context.addIssue({
          code: "custom",
          message: "Selection contains a duplicate node identifier",
          path: ["selection", index, "id"],
        });
      }
      identifiers.add(node.id);
      sourcePointCount += node.source?.segments.reduce(
        (total, segment) => total + segment.points.length,
        0,
      ) ?? 0;
    });
    if (sourcePointCount > 4_096) {
      context.addIssue({
        code: "custom",
        message: "Selection vector geometry exceeds the 4096-point request limit",
        path: ["selection"],
      });
    }
  });

export type ProposalNodeSnapshot = z.infer<typeof ProposalNodeSnapshotSchema>;
export type AiProposalRequest = z.infer<typeof AiProposalRequestSchema>;

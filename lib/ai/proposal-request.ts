import { z } from "zod";

import {
  CanvasIdentifierSchema,
  CanvasNodeTypeSchema,
} from "./canvas-patch";
import {
  AiAssistanceModeSchema,
  resolveAiAssistanceMode,
} from "./assistance-mode";

const SnapshotCoordinateSchema = z.number().finite().min(-100_000).max(100_000);
const SnapshotDimensionSchema = z.number().finite().min(24).max(10_000);

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
  })
  .strict();

export const AiProposalRequestSchema = z
  .object({
    skill: z.literal("cluster-by-theme").default("cluster-by-theme"),
    mode: AiAssistanceModeSchema.optional(),
    workspaceId: CanvasIdentifierSchema,
    boardId: CanvasIdentifierSchema,
    documentGenerationId: CanvasIdentifierSchema,
    durableSequence: z.number().int().nonnegative().safe(),
    instruction: z.string().trim().min(1).max(2_000),
    selection: z.array(ProposalNodeSnapshotSchema).min(1).max(40),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      resolveAiAssistanceMode(value.mode) !== "feedback" &&
      value.selection.length < 2
    ) {
      context.addIssue({
        code: "custom",
        message: "Suggest and solve require at least two selected nodes",
        path: ["selection"],
      });
    }
    const identifiers = new Set<string>();
    value.selection.forEach((node, index) => {
      if (identifiers.has(node.id)) {
        context.addIssue({
          code: "custom",
          message: "Selection contains a duplicate node identifier",
          path: ["selection", index, "id"],
        });
      }
      identifiers.add(node.id);
    });
  });

export type AiProposalRequest = z.infer<typeof AiProposalRequestSchema>;

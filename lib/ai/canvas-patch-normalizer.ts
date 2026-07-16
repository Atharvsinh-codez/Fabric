import { z } from "zod";

/**
 * A narrowly-scoped compatibility shape observed from OpenAI-compatible
 * gateways that accept JSON Schema requests but return compact field aliases.
 * All values still pass through the canonical CanvasPatch schema and semantic
 * authorization checks after this structural translation.
 */
const CompactCanvasPatchSchema = z
  .object({
    schemaVersion: z.unknown(),
    summary: z.unknown(),
    workspaceId: z.unknown(),
    boardId: z.unknown(),
    documentGenerationId: z.unknown(),
    durableSequence: z.unknown(),
    selectionHash: z.unknown(),
    ops: z.array(z.unknown()).min(1).max(100),
  })
  .strict();

const CompactWriteTextOperationSchema = z
  .object({
    type: z.literal("writeText"),
    id: z.unknown(),
    x: z.unknown(),
    y: z.unknown(),
    text: z.unknown(),
    fontSize: z.unknown().optional(),
    maxWidth: z.unknown().optional(),
    color: z.unknown().optional(),
    parentId: z.unknown().optional(),
  })
  .strict();

const DEFAULT_PEN_FONT_SIZE = 28;
const DEFAULT_PEN_MAX_WIDTH = 640;

function normalizeCompactOperation(operation: unknown): unknown | null {
  const writeText = CompactWriteTextOperationSchema.safeParse(operation);
  if (!writeText.success) return null;

  return {
    type: "writeText",
    tempId: writeText.data.id,
    position: { x: writeText.data.x, y: writeText.data.y },
    text: writeText.data.text,
    fontSize:
      writeText.data.fontSize === undefined
        ? DEFAULT_PEN_FONT_SIZE
        : writeText.data.fontSize,
    maxWidth:
      writeText.data.maxWidth === undefined
        ? DEFAULT_PEN_MAX_WIDTH
        : writeText.data.maxWidth,
    ...(writeText.data.color === undefined ? {} : { color: writeText.data.color }),
    ...(writeText.data.parentId === undefined
      ? {}
      : { parentId: writeText.data.parentId }),
  };
}

/**
 * Converts only the exact, known compact writeText wire shape into canonical
 * CanvasPatch field names. Unknown, mixed, or extra fields are returned
 * untouched so the strict canonical validator rejects them.
 */
export type CanvasPatchCandidateNormalization = Readonly<{
  value: unknown;
  compatibilityMode: "none" | "compact_write_text_v1";
}>;

export function normalizeCanvasPatchCandidate(
  candidate: unknown,
): CanvasPatchCandidateNormalization {
  const compact = CompactCanvasPatchSchema.safeParse(candidate);
  if (!compact.success) return { value: candidate, compatibilityMode: "none" };

  const operations: unknown[] = [];
  for (const operation of compact.data.ops) {
    const normalized = normalizeCompactOperation(operation);
    if (normalized === null) return { value: candidate, compatibilityMode: "none" };
    operations.push(normalized);
  }

  return {
    compatibilityMode: "compact_write_text_v1",
    value: {
      schemaVersion: compact.data.schemaVersion,
      summary: compact.data.summary,
      base: {
        workspaceId: compact.data.workspaceId,
        boardId: compact.data.boardId,
        documentGenerationId: compact.data.documentGenerationId,
        durableSequence: compact.data.durableSequence,
        selectionHash: compact.data.selectionHash,
      },
      operations,
    },
  };
}

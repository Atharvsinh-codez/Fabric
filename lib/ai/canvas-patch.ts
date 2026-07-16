import { z } from "zod";

export const CanvasIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Invalid canvas identifier");

export const TemporaryIdentifierSchema = z
  .string()
  .trim()
  .regex(/^tmp_[A-Za-z0-9_-]{1,60}$/, "Temporary identifiers must start with tmp_");

const NodeReferenceSchema = z.union([CanvasIdentifierSchema, TemporaryIdentifierSchema]);
const FiniteCoordinateSchema = z.number().finite().min(-100_000).max(100_000);
const DimensionSchema = z.number().finite().min(24).max(10_000);
const LocalVectorCoordinateSchema = z.number().finite().min(0).max(10_000);

export const CanvasColorTokenSchema = z.enum([
  "surface",
  "ink",
  "sky",
  "mint",
  "butter",
  "lavender",
  "rose",
  "fog",
]);

/** Shape kinds that may be sent to the model as authorized source material. */
export const CanvasSelectableNodeTypeSchema = z.enum([
  "frame",
  "note",
  "text",
  "rectangle",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "image",
  "drawing",
  "summary",
]);

/** Shape kinds the model may create. Images are deliberately source-only. */
export const CanvasCreatableNodeTypeSchema = z.enum([
  "frame",
  "note",
  "text",
  "rectangle",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "summary",
]);

/** Backwards-compatible name for selection and semantic snapshot consumers. */
export const CanvasNodeTypeSchema = CanvasSelectableNodeTypeSchema;

export const CanvasVectorPointSchema = z
  .object({
    x: LocalVectorCoordinateSchema,
    y: LocalVectorCoordinateSchema,
    z: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

export const CanvasVectorSegmentSchema = z
  .object({
    type: z.enum(["free", "straight"]),
    points: z.array(CanvasVectorPointSchema).min(2).max(64),
  })
  .strict();

const CanvasVectorSegmentsSchema = z
  .array(CanvasVectorSegmentSchema)
  .min(1)
  .max(64)
  .superRefine((segments, context) => {
    const pointCount = segments.reduce((total, segment) => total + segment.points.length, 0);
    if (pointCount > 2_048) {
      context.addIssue({
        code: "custom",
        message: "Vector geometry exceeds the 2048-point limit",
      });
    }
  });

const CanvasDrawingSegmentsSchema = CanvasVectorSegmentsSchema.superRefine(
  (segments, context) => {
    const pointCount = segments.reduce((total, segment) => total + segment.points.length, 0);
    if (pointCount > 512) {
      context.addIssue({
        code: "custom",
        message: "Created drawing exceeds the 512-point limit",
      });
    }
  },
);

export const CanvasSourceGeometrySchema = z
  .object({
    shapeType: z.enum(["draw", "highlight", "line"]),
    segments: CanvasVectorSegmentsSchema,
  })
  .strict();

const PositionSchema = z
  .object({
    x: FiniteCoordinateSchema,
    y: FiniteCoordinateSchema,
  })
  .strict();

const SizeSchema = z
  .object({
    width: DimensionSchema,
    height: DimensionSchema,
  })
  .strict();

const NodeContentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().max(4_000).optional(),
    tag: z.string().trim().min(1).max(64).optional(),
    meta: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const NodeAppearanceSchema = z
  .object({
    fill: CanvasColorTokenSchema.optional(),
    textColor: z.enum(["ink", "surface", "muted"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Appearance cannot be empty");

const CreateNodeOperationSchema = z
  .object({
    type: z.literal("createNode"),
    tempId: TemporaryIdentifierSchema,
    nodeType: CanvasCreatableNodeTypeSchema,
    position: PositionSchema,
    size: SizeSchema,
    content: NodeContentSchema,
    appearance: NodeAppearanceSchema.optional(),
    parentId: NodeReferenceSchema.optional(),
  })
  .strict();

const WriteTextOperationSchema = z
  .object({
    type: z.literal("writeText"),
    tempId: TemporaryIdentifierSchema,
    position: PositionSchema,
    text: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => value.trim().length > 0, "Pen text cannot be blank"),
    fontSize: z.number().finite().min(12).max(96),
    maxWidth: z.number().finite().min(60).max(2_000),
    color: CanvasColorTokenSchema.optional(),
    parentId: NodeReferenceSchema.optional(),
  })
  .strict();

const CreateDrawingOperationSchema = z
  .object({
    type: z.literal("createDrawing"),
    tempId: TemporaryIdentifierSchema,
    position: PositionSchema,
    segments: CanvasDrawingSegmentsSchema,
    color: CanvasColorTokenSchema.optional(),
    size: z.enum(["s", "m", "l", "xl"]).optional(),
    parentId: NodeReferenceSchema.optional(),
  })
  .strict();

const UpdateNodeOperationSchema = z
  .object({
    type: z.literal("updateNode"),
    nodeId: NodeReferenceSchema,
    content: NodeContentSchema.partial().strict().optional(),
    appearance: NodeAppearanceSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.content !== undefined && Object.keys(value.content).length > 0) ||
      value.appearance !== undefined,
    "updateNode must change content or appearance",
  );

const MoveNodeOperationSchema = z
  .object({
    type: z.literal("moveNode"),
    nodeId: NodeReferenceSchema,
    position: PositionSchema,
    parentId: NodeReferenceSchema.nullable().optional(),
  })
  .strict();

const ResizeNodeOperationSchema = z
  .object({
    type: z.literal("resizeNode"),
    nodeId: NodeReferenceSchema,
    size: SizeSchema,
  })
  .strict();

const CreateConnectorOperationSchema = z
  .object({
    type: z.literal("createConnector"),
    tempId: TemporaryIdentifierSchema,
    sourceId: NodeReferenceSchema,
    targetId: NodeReferenceSchema,
    route: z.enum(["straight", "elbow"]),
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const DeleteNodeOperationSchema = z
  .object({
    type: z.literal("deleteNode"),
    nodeId: NodeReferenceSchema,
  })
  .strict();

export const CanvasOperationSchema = z.discriminatedUnion("type", [
  CreateNodeOperationSchema,
  WriteTextOperationSchema,
  CreateDrawingOperationSchema,
  UpdateNodeOperationSchema,
  MoveNodeOperationSchema,
  ResizeNodeOperationSchema,
  CreateConnectorOperationSchema,
  DeleteNodeOperationSchema,
]);

export const CanvasPatchSchema = z
  .object({
    schemaVersion: z.literal(1),
    summary: z.string().trim().min(1).max(500),
    base: z
      .object({
        workspaceId: CanvasIdentifierSchema,
        boardId: CanvasIdentifierSchema,
        documentGenerationId: CanvasIdentifierSchema,
        durableSequence: z.number().int().nonnegative().safe(),
        selectionHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      })
      .strict(),
    operations: z.array(CanvasOperationSchema).min(1).max(100),
  })
  .strict();

export type CanvasOperation = z.infer<typeof CanvasOperationSchema>;
export type CanvasPatch = z.infer<typeof CanvasPatchSchema>;
export type CanvasNodeType = z.infer<typeof CanvasSelectableNodeTypeSchema>;
export type CanvasCreatableNodeType = z.infer<typeof CanvasCreatableNodeTypeSchema>;
export type CanvasSourceGeometry = z.infer<typeof CanvasSourceGeometrySchema>;

/** The provider schema and the runtime validator are generated from one source. */
export const CANVAS_PATCH_JSON_SCHEMA = Object.freeze(
  z.toJSONSchema(CanvasPatchSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  }) as Record<string, unknown>,
);

import { z } from "zod";

export const BOARD_PLAN_SCHEMA_VERSION = 1 as const;

/**
 * Exact string domains shared by runtime validation, the provider JSON Schema,
 * and the model prompt. Keep these paths exhaustive for every z.enum in v1 so
 * a model never has to invent a synonym such as "radial" or "columns".
 */
export const BOARD_PLAN_ENUM_DOMAINS = Object.freeze({
  placement: Object.freeze([
    "selection-right",
    "selection-below",
    "viewport-center",
  ] as const),
  flow: Object.freeze(["vertical", "horizontal", "grid"] as const),
  tone: Object.freeze(["neutral", "blue", "green", "yellow", "purple", "red"] as const),
  textBlockRole: Object.freeze(["heading", "body", "equation", "answer", "label"] as const),
  cardVariant: Object.freeze(["note", "summary"] as const),
  nativeShape: Object.freeze([
    "rectangle",
    "ellipse",
    "diamond",
    "triangle",
    "hexagon",
  ] as const),
  diagramNodeShape: Object.freeze([
    "note",
    "summary",
    "rectangle",
    "ellipse",
    "diamond",
    "triangle",
    "hexagon",
  ] as const),
  diagramLayout: Object.freeze([
    "flow-horizontal",
    "flow-vertical",
    "hierarchy",
    "mind-map",
    "cycle",
  ] as const),
  arrangement: Object.freeze(["row", "column", "grid", "circle"] as const),
  spacing: Object.freeze(["compact", "comfortable", "spacious"] as const),
  textTone: Object.freeze(["dark", "light", "muted"] as const),
  clarificationReason: Object.freeze([
    "ambiguous",
    "missing-context",
    "missing-selection",
    "unsupported",
  ] as const),
});

export const BOARD_PLAN_LIMITS = Object.freeze({
  maxActions: 16,
  maxGeneratedElements: 40,
  maxSelectionReferences: 80,
  maxTextCharacters: 9_000,
  maxTextBlocks: 12,
  maxBatchItems: 16,
  // Eleven worst-case 760px nodes plus gaps and frame chrome remain below
  // CanvasPatch's 10,000px dimension ceiling in a vertical diagram.
  maxDiagramNodes: 11,
  maxDiagramConnections: 40,
  maxCompiledOperations: 100,
});

/**
 * A model-authored name used only to relate semantic items inside one plan.
 * It is deliberately not a canvas identifier and can never be a temporary ID.
 */
export const BoardPlanKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(
    /^(?!tmp_)[a-z][a-z0-9_-]*$/,
    "Plan keys must be lowercase semantic names and cannot start with tmp_",
  );

/**
 * An opaque reference copied from the authorized selection supplied to the
 * model. The compiler must still verify membership in that selection.
 */
export const BoardSelectionReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^(?!tmp_)[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    "Selection references must be existing opaque references, not temporary IDs",
  );

export const BoardPlanToneSchema = z.enum(BOARD_PLAN_ENUM_DOMAINS.tone);

const SummarySchema = z.string().trim().min(1).max(240);
const TitleSchema = z.string().trim().min(1).max(120);
const BodySchema = z.string().trim().min(1).max(720);
const LabelSchema = z.string().trim().min(1).max(160);

const TextBlockSchema = z
  .object({
    role: z.enum(BOARD_PLAN_ENUM_DOMAINS.textBlockRole),
    text: z
      .string()
      .min(1)
      .max(900)
      .refine((value) => value.trim().length > 0, "Text blocks cannot be blank"),
  })
  .strict();

const ComposeTextActionSchema = z
  .object({
    kind: z.literal("composeText"),
    key: BoardPlanKeySchema,
    presentation: z.literal("typed"),
    blocks: z.array(TextBlockSchema).min(1).max(BOARD_PLAN_LIMITS.maxTextBlocks),
    tone: BoardPlanToneSchema.optional(),
  })
  .strict();

const CardSchema = z
  .object({
    key: BoardPlanKeySchema,
    variant: z.enum(BOARD_PLAN_ENUM_DOMAINS.cardVariant),
    title: TitleSchema,
    body: BodySchema.optional(),
    tone: BoardPlanToneSchema.optional(),
  })
  .strict();

const AddCardsActionSchema = z
  .object({
    kind: z.literal("addCards"),
    cards: z.array(CardSchema).min(1).max(BOARD_PLAN_LIMITS.maxBatchItems),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateKeyIssues(value.cards, context, ["cards"]);
  });

const NativeShapeSchema = z.enum(BOARD_PLAN_ENUM_DOMAINS.nativeShape);

const ShapeSchema = z
  .object({
    key: BoardPlanKeySchema,
    shape: NativeShapeSchema,
    label: LabelSchema,
    detail: BodySchema.optional(),
    tone: BoardPlanToneSchema.optional(),
  })
  .strict();

const AddShapesActionSchema = z
  .object({
    kind: z.literal("addShapes"),
    shapes: z.array(ShapeSchema).min(1).max(BOARD_PLAN_LIMITS.maxBatchItems),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateKeyIssues(value.shapes, context, ["shapes"]);
  });

const DiagramNodeSchema = z
  .object({
    key: BoardPlanKeySchema,
    shape: z.enum(BOARD_PLAN_ENUM_DOMAINS.diagramNodeShape).describe(
      'Canonical diagram-node field: use "shape" with one allowed native shape; "role" is not valid.',
    ),
    label: LabelSchema,
    detail: BodySchema.optional(),
    tone: BoardPlanToneSchema.optional(),
  })
  .strict();

const DiagramConnectionSchema = z
  .object({
    from: BoardPlanKeySchema,
    to: BoardPlanKeySchema,
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const AddDiagramActionSchema = z
  .object({
    kind: z.literal("addDiagram"),
    key: BoardPlanKeySchema,
    title: TitleSchema.optional(),
    layout: z.enum(BOARD_PLAN_ENUM_DOMAINS.diagramLayout),
    nodes: z.array(DiagramNodeSchema).min(2).max(BOARD_PLAN_LIMITS.maxDiagramNodes),
    connections: z
      .array(DiagramConnectionSchema)
      .min(1)
      .max(BOARD_PLAN_LIMITS.maxDiagramConnections),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateKeyIssues(value.nodes, context, ["nodes"]);
    const nodeKeys = new Set(value.nodes.map((node) => node.key));

    value.connections.forEach((connection, index) => {
      if (!nodeKeys.has(connection.from)) {
        context.addIssue({
          code: "custom",
          message: `Unknown diagram source key: ${connection.from}`,
          path: ["connections", index, "from"],
        });
      }
      if (!nodeKeys.has(connection.to)) {
        context.addIssue({
          code: "custom",
          message: `Unknown diagram target key: ${connection.to}`,
          path: ["connections", index, "to"],
        });
      }
      if (connection.from === connection.to) {
        context.addIssue({
          code: "custom",
          message: "Diagram connections cannot connect a node to itself",
          path: ["connections", index],
        });
      }
    });
  });

const UniqueSelectionReferencesSchema = z
  .array(BoardSelectionReferenceSchema)
  .min(1)
  .max(40)
  .superRefine((references, context) => {
    addDuplicateReferenceIssues(references, context);
  });

const ArrangeSelectionActionSchema = z
  .object({
    kind: z.literal("arrangeSelection"),
    selectionRefs: UniqueSelectionReferencesSchema.min(2).describe(
      'Canonical array of opaque writable handles; use "selectionRefs", never "ids".',
    ),
    arrangement: z.enum(BOARD_PLAN_ENUM_DOMAINS.arrangement).describe(
      'Canonical arrangement field; "layout" and "columns" are not valid aliases.',
    ),
    spacing: z.enum(BOARD_PLAN_ENUM_DOMAINS.spacing).describe(
      'Canonical spacing field; use one named spacing value and never a numeric gap.',
    ),
  })
  .strict();

const SelectionEditSchema = z
  .object({
    selectionRef: BoardSelectionReferenceSchema,
    title: TitleSchema.optional(),
    // An explicit empty string means "clear the existing body". The approval
    // verifier normalizes that to the durable projection's omitted body.
    body: z.string().max(2_000).optional(),
    tag: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    (value) => value.title !== undefined || value.body !== undefined || value.tag !== undefined,
    "A selection edit must change title, body, or tag",
  );

const EditSelectionActionSchema = z
  .object({
    kind: z.literal("editSelection"),
    edits: z.array(SelectionEditSchema).min(1).max(40),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateReferenceIssues(
      value.edits.map((edit) => edit.selectionRef),
      context,
      ["edits"],
    );
  });

const SelectionStyleSchema = z
  .object({
    tone: BoardPlanToneSchema.optional(),
    textTone: z.enum(BOARD_PLAN_ENUM_DOMAINS.textTone).optional(),
  })
  .strict()
  .refine(
    (value) => value.tone !== undefined || value.textTone !== undefined,
    "Selection style cannot be empty",
  );

const StyleSelectionActionSchema = z
  .object({
    kind: z.literal("styleSelection"),
    selectionRefs: UniqueSelectionReferencesSchema,
    style: SelectionStyleSchema,
  })
  .strict();

export const BoardPlanActionSchema = z.discriminatedUnion("kind", [
  ComposeTextActionSchema,
  AddCardsActionSchema,
  AddShapesActionSchema,
  AddDiagramActionSchema,
  ArrangeSelectionActionSchema,
  EditSelectionActionSchema,
  StyleSelectionActionSchema,
]);

export const BoardProposalSchema = z
  .object({
    schemaVersion: z.literal(BOARD_PLAN_SCHEMA_VERSION),
    kind: z.literal("proposal"),
    summary: SummarySchema,
    placement: z.enum(BOARD_PLAN_ENUM_DOMAINS.placement),
    flow: z.enum(BOARD_PLAN_ENUM_DOMAINS.flow),
    actions: z.array(BoardPlanActionSchema).min(1).max(BOARD_PLAN_LIMITS.maxActions),
  })
  .strict()
  .superRefine((value, context) => {
    const topLevelKeys: Array<{ key: string; path: Array<string | number> }> = [];
    let generatedElements = 0;
    let selectionReferences = 0;
    let textCharacters = value.summary.length;
    let estimatedOperations = 0;

    value.actions.forEach((action, actionIndex) => {
      switch (action.kind) {
        case "composeText":
          topLevelKeys.push({ key: action.key, path: ["actions", actionIndex, "key"] });
          generatedElements += action.blocks.length;
          estimatedOperations += action.blocks.length;
          textCharacters += action.blocks.reduce((total, block) => total + block.text.length, 0);
          break;
        case "addCards":
          action.cards.forEach((card, cardIndex) => {
            topLevelKeys.push({
              key: card.key,
              path: ["actions", actionIndex, "cards", cardIndex, "key"],
            });
            textCharacters += card.title.length + (card.body?.length ?? 0);
          });
          generatedElements += action.cards.length;
          estimatedOperations += action.cards.length;
          break;
        case "addShapes":
          action.shapes.forEach((shape, shapeIndex) => {
            topLevelKeys.push({
              key: shape.key,
              path: ["actions", actionIndex, "shapes", shapeIndex, "key"],
            });
            textCharacters += shape.label.length + (shape.detail?.length ?? 0);
          });
          generatedElements += action.shapes.length;
          estimatedOperations += action.shapes.length;
          break;
        case "addDiagram":
          topLevelKeys.push({ key: action.key, path: ["actions", actionIndex, "key"] });
          generatedElements += action.nodes.length + action.connections.length;
          estimatedOperations += action.nodes.length + action.connections.length + 1;
          textCharacters +=
            (action.title?.length ?? 0) +
            action.nodes.reduce(
              (total, node) => total + node.label.length + (node.detail?.length ?? 0),
              0,
            ) +
            action.connections.reduce(
              (total, connection) => total + (connection.label?.length ?? 0),
              0,
            );
          break;
        case "arrangeSelection":
        case "styleSelection":
          selectionReferences += action.selectionRefs.length;
          estimatedOperations += action.selectionRefs.length;
          break;
        case "editSelection":
          selectionReferences += action.edits.length;
          estimatedOperations += action.edits.length;
          textCharacters += action.edits.reduce(
            (total, edit) =>
              total +
              (edit.title?.length ?? 0) +
              (edit.body?.length ?? 0) +
              (edit.tag?.length ?? 0),
            0,
          );
          break;
      }
    });

    const seenKeys = new Set<string>();
    topLevelKeys.forEach(({ key, path }) => {
      if (seenKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate top-level plan key: ${key}`,
          path,
        });
      }
      seenKeys.add(key);
    });

    if (generatedElements > BOARD_PLAN_LIMITS.maxGeneratedElements) {
      context.addIssue({
        code: "custom",
        message: `Plan exceeds the ${BOARD_PLAN_LIMITS.maxGeneratedElements}-element generation limit`,
        path: ["actions"],
      });
    }
    if (selectionReferences > BOARD_PLAN_LIMITS.maxSelectionReferences) {
      context.addIssue({
        code: "custom",
        message: `Plan exceeds the ${BOARD_PLAN_LIMITS.maxSelectionReferences}-reference selection limit`,
        path: ["actions"],
      });
    }
    if (textCharacters > BOARD_PLAN_LIMITS.maxTextCharacters) {
      context.addIssue({
        code: "custom",
        message: `Plan exceeds the ${BOARD_PLAN_LIMITS.maxTextCharacters}-character content limit`,
        path: ["actions"],
      });
    }
    if (estimatedOperations > BOARD_PLAN_LIMITS.maxCompiledOperations) {
      context.addIssue({
        code: "custom",
        message: `Plan can compile to at most ${BOARD_PLAN_LIMITS.maxCompiledOperations} operations`,
        path: ["actions"],
      });
    }
  });

export const BoardClarificationSchema = z
  .object({
    schemaVersion: z.literal(BOARD_PLAN_SCHEMA_VERSION),
    kind: z.literal("clarification"),
    reason: z.enum(BOARD_PLAN_ENUM_DOMAINS.clarificationReason),
    question: z.string().trim().min(1).max(400),
    choices: z.array(z.string().trim().min(1).max(120)).max(4),
  })
  .strict();

export const BoardPlanSchema = z.discriminatedUnion("kind", [
  BoardProposalSchema,
  BoardClarificationSchema,
]);

export type BoardPlan = z.infer<typeof BoardPlanSchema>;
export type BoardProposal = z.infer<typeof BoardProposalSchema>;
export type BoardClarification = z.infer<typeof BoardClarificationSchema>;
export type BoardPlanAction = z.infer<typeof BoardPlanActionSchema>;
export type BoardPlanKey = z.infer<typeof BoardPlanKeySchema>;
export type BoardSelectionReference = z.infer<typeof BoardSelectionReferenceSchema>;
export type BoardPlanTone = z.infer<typeof BoardPlanToneSchema>;

/** Provider response schema and runtime validation share this single source. */
export const BOARD_PLAN_JSON_SCHEMA = Object.freeze(
  z.toJSONSchema(BoardPlanSchema, {
    target: "draft-7",
    unrepresentable: "throw",
  }) as Record<string, unknown>,
);

function addDuplicateKeyIssues(
  values: readonly { key: string }[],
  context: z.RefinementCtx,
  pathPrefix: Array<string | number>,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.key)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate plan key: ${value.key}`,
        path: [...pathPrefix, index, "key"],
      });
    }
    seen.add(value.key);
  });
}

function addDuplicateReferenceIssues(
  references: readonly string[],
  context: z.RefinementCtx,
  pathPrefix: Array<string | number> = [],
): void {
  const seen = new Set<string>();
  references.forEach((reference, index) => {
    if (seen.has(reference)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate selection reference: ${reference}`,
        path: [...pathPrefix, index],
      });
    }
    seen.add(reference);
  });
}

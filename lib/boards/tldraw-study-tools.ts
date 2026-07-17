import {
  createShapeId,
  toRichText,
  type Editor,
  type TLArrowShape,
  type TLDefaultColorStyle,
  type TLGeoShape,
  type TLShapeId,
  type TLShapePartial,
  type TLTextShape,
} from "tldraw";

import {
  calculateStudyExpression,
  type StudyCalculationResult,
} from "./study-calculator";

export const STUDY_KIT_IDS = [
  "cornell-notes",
  "concept-map",
  "study-planner",
  "recall-cards",
] as const;

export type StudyKitId = (typeof STUDY_KIT_IDS)[number];

export type StudyKitDefinition = Readonly<{
  id: StudyKitId;
  name: string;
  description: string;
  width: number;
  height: number;
}>;

export const STUDY_KITS: readonly StudyKitDefinition[] = [
  {
    id: "cornell-notes",
    name: "Cornell Notes",
    description: "Capture notes, cues, and a concise summary in one editable layout.",
    width: 1_180,
    height: 820,
  },
  {
    id: "concept-map",
    name: "Concept Map",
    description: "Break a topic into connected ideas, examples, questions, and evidence.",
    width: 1_160,
    height: 760,
  },
  {
    id: "study-planner",
    name: "Study Planner",
    description: "Turn a weekly goal into focused sessions, practice, and review work.",
    width: 1_240,
    height: 760,
  },
  {
    id: "recall-cards",
    name: "Recall Cards",
    description: "Create question-and-answer pairs for active recall with classmates.",
    width: 1_180,
    height: 820,
  },
] as const;

type StudyShape = TLShapePartial<TLArrowShape | TLGeoShape | TLTextShape>;
type StudyPoint = Readonly<{ x: number; y: number }>;

type StudyEditor = Pick<
  Editor,
  | "createShapes"
  | "bailToMark"
  | "getInstanceState"
  | "getShape"
  | "getViewportPageBounds"
  | "markHistoryStoppingPoint"
  | "run"
  | "select"
  | "squashToMark"
  | "zoomToSelection"
>;

type ShapeContext = Readonly<{
  toolId: StudyKitId | "calculator";
  instanceId: string;
  origin: StudyPoint;
}>;

export type StudyKitBuildResult = Readonly<{
  kit: StudyKitDefinition;
  origin: StudyPoint;
  shapeIds: readonly TLShapeId[];
  shapes: readonly StudyShape[];
}>;

export type StudyToolInsertionResult =
  | Readonly<{
      ok: true;
      name: string;
      shapeIds: readonly TLShapeId[];
    }>
  | Readonly<{
      ok: false;
      reason: "editor-unavailable" | "readonly" | "capacity" | "invalid-calculation";
    }>;

const normalizeIdSegment = (value: string) =>
  value.replaceAll(/[^a-zA-Z0-9_-]/g, "-").replaceAll(/-+/g, "-").slice(0, 72) || "item";

const shapeId = (context: ShapeContext, key: string) =>
  createShapeId(
    `fabric-study-${normalizeIdSegment(context.toolId)}-${normalizeIdSegment(context.instanceId)}-${normalizeIdSegment(key)}`,
  );

const shapeMeta = (context: ShapeContext, key: string) => ({
  fabricStudyTool: context.toolId,
  fabricStudyInstanceId: context.instanceId,
  fabricStudyKey: key,
});

function textShape(
  context: ShapeContext,
  options: Readonly<{
    key: string;
    x: number;
    y: number;
    width: number;
    text: string;
    size?: "s" | "m" | "l" | "xl";
    color?: TLDefaultColorStyle;
  }>,
): TLShapePartial<TLTextShape> {
  return {
    id: shapeId(context, options.key),
    type: "text",
    x: context.origin.x + options.x,
    y: context.origin.y + options.y,
    meta: shapeMeta(context, options.key),
    props: {
      autoSize: false,
      color: options.color ?? "black",
      font: "sans",
      richText: toRichText(options.text),
      scale: 1,
      size: options.size ?? "m",
      textAlign: "start",
      w: options.width,
    },
  };
}

function geoShape(
  context: ShapeContext,
  options: Readonly<{
    key: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    color?: TLDefaultColorStyle;
    labelColor?: TLDefaultColorStyle;
    fill?: "none" | "semi" | "solid" | "pattern";
    geo?: "ellipse" | "rectangle";
    align?: "end" | "middle" | "start";
    verticalAlign?: "end" | "middle" | "start";
    size?: "s" | "m" | "l" | "xl";
  }>,
): TLShapePartial<TLGeoShape> {
  return {
    id: shapeId(context, options.key),
    type: "geo",
    x: context.origin.x + options.x,
    y: context.origin.y + options.y,
    meta: shapeMeta(context, options.key),
    props: {
      align: options.align ?? "start",
      color: options.color ?? "light-blue",
      dash: "solid",
      fill: options.fill ?? "semi",
      font: "sans",
      geo: options.geo ?? "rectangle",
      growY: 0,
      h: options.height,
      labelColor: options.labelColor ?? "black",
      richText: toRichText(options.text ?? ""),
      scale: 1,
      size: options.size ?? "m",
      url: "",
      verticalAlign: options.verticalAlign ?? "start",
      w: options.width,
    },
  };
}

function arrowShape(
  context: ShapeContext,
  options: Readonly<{
    key: string;
    start: StudyPoint;
    end: StudyPoint;
    color?: TLDefaultColorStyle;
  }>,
): TLShapePartial<TLArrowShape> {
  return {
    id: shapeId(context, options.key),
    type: "arrow",
    x: context.origin.x + options.start.x,
    y: context.origin.y + options.start.y,
    meta: shapeMeta(context, options.key),
    props: {
      arrowheadEnd: "arrow",
      arrowheadStart: "none",
      bend: 0,
      color: options.color ?? "light-blue",
      dash: "solid",
      elbowMidPoint: 0.5,
      end: {
        x: options.end.x - options.start.x,
        y: options.end.y - options.start.y,
      },
      fill: "none",
      font: "sans",
      kind: "arc",
      labelColor: "black",
      labelPosition: 0.5,
      richText: toRichText(""),
      scale: 1,
      size: "s",
      start: { x: 0, y: 0 },
    },
  };
}

const buildCornellNotes = (context: ShapeContext): StudyShape[] => [
  textShape(context, {
    key: "title",
    x: 0,
    y: 0,
    width: 760,
    text: "Cornell Notes",
    size: "xl",
  }),
  textShape(context, {
    key: "subtitle",
    x: 0,
    y: 56,
    width: 980,
    text: "Topic: ____________________    Date: __________    Course: ____________________",
  }),
  geoShape(context, {
    key: "cues",
    x: 0,
    y: 122,
    width: 310,
    height: 470,
    text: "Cues and Questions\n\nKeywords\n\nQuestions to test later\n\nImportant formulas",
    color: "yellow",
  }),
  geoShape(context, {
    key: "notes",
    x: 330,
    y: 122,
    width: 850,
    height: 470,
    text: "Notes\n\nCapture the main ideas in your own words. Add examples, diagrams, and links between concepts.",
    color: "light-blue",
  }),
  geoShape(context, {
    key: "summary",
    x: 0,
    y: 612,
    width: 1_180,
    height: 170,
    text: "Summary\n\nExplain the lesson in three to five sentences without looking back at your notes.",
    color: "light-green",
  }),
];

const conceptBranches = [
  {
    id: "definition",
    title: "Definition",
    prompt: "What does it mean?",
    x: 40,
    y: 150,
    color: "light-blue" as const,
  },
  {
    id: "evidence",
    title: "Evidence",
    prompt: "What proves it?",
    x: 820,
    y: 150,
    color: "light-green" as const,
  },
  {
    id: "example",
    title: "Example",
    prompt: "Where can I see it?",
    x: 40,
    y: 520,
    color: "yellow" as const,
  },
  {
    id: "question",
    title: "Open Question",
    prompt: "What is still unclear?",
    x: 820,
    y: 520,
    color: "light-violet" as const,
  },
] as const;

function buildConceptMap(context: ShapeContext): StudyShape[] {
  const center = { x: 580, y: 390 };
  const shapes: StudyShape[] = [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 760,
      text: "Concept Map",
      size: "xl",
    }),
    textShape(context, {
      key: "subtitle",
      x: 0,
      y: 56,
      width: 920,
      text: "Replace the prompts, then add branches as your understanding grows.",
    }),
  ];

  conceptBranches.forEach((branch) => {
    const target = { x: branch.x + 150, y: branch.y + 80 };
    shapes.push(
      arrowShape(context, {
        key: `connection-${branch.id}`,
        start: center,
        end: target,
      }),
    );
  });
  shapes.push(
    geoShape(context, {
      key: "topic",
      x: 430,
      y: 310,
      width: 300,
      height: 160,
      text: "Main Topic\nWhat are you learning?",
      color: "blue",
      fill: "solid",
      geo: "ellipse",
      labelColor: "white",
      align: "middle",
      verticalAlign: "middle",
      size: "l",
    }),
  );
  conceptBranches.forEach((branch) => {
    shapes.push(
      geoShape(context, {
        key: branch.id,
        x: branch.x,
        y: branch.y,
        width: 300,
        height: 160,
        text: `${branch.title}\n${branch.prompt}`,
        color: branch.color,
        fill: "solid",
        verticalAlign: "middle",
      }),
    );
  });
  return shapes;
}

const plannerColumns = [
  {
    id: "learn",
    name: "Learn",
    prompt: "New concepts and reading",
    color: "light-blue" as const,
  },
  {
    id: "practice",
    name: "Practice",
    prompt: "Problems, drills, and examples",
    color: "light-violet" as const,
  },
  {
    id: "recall",
    name: "Recall",
    prompt: "Test without looking at notes",
    color: "yellow" as const,
  },
  {
    id: "review",
    name: "Review",
    prompt: "Mistakes and next revision",
    color: "light-green" as const,
  },
] as const;

function buildStudyPlanner(context: ShapeContext): StudyShape[] {
  const shapes: StudyShape[] = [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 760,
      text: "Weekly Study Planner",
      size: "xl",
    }),
    geoShape(context, {
      key: "weekly-goal",
      x: 0,
      y: 70,
      width: 1_240,
      height: 110,
      text: "Weekly Goal\nWhat will you be able to explain or solve by the end of this week?",
      color: "blue",
      fill: "semi",
    }),
  ];
  plannerColumns.forEach((column, index) => {
    shapes.push(
      geoShape(context, {
        key: column.id,
        x: index * 310,
        y: 205,
        width: 290,
        height: 500,
        text: `${column.name}\n${column.prompt}\n\n1. __________________\n\n2. __________________\n\n3. __________________\n\nCheck: ______________`,
        color: column.color,
        fill: "semi",
      }),
    );
  });
  return shapes;
}

function buildRecallCards(context: ShapeContext): StudyShape[] {
  const shapes: StudyShape[] = [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 760,
      text: "Recall Cards",
      size: "xl",
    }),
    textShape(context, {
      key: "subtitle",
      x: 0,
      y: 56,
      width: 980,
      text: "Hide the answer column, explain each question aloud, then reveal and correct.",
    }),
  ];

  for (let index = 0; index < 3; index += 1) {
    const y = 126 + index * 220;
    shapes.push(
      geoShape(context, {
        key: `question-${index + 1}`,
        x: 0,
        y,
        width: 560,
        height: 190,
        text: `Question ${index + 1}\nWrite a prompt that requires you to retrieve the idea from memory.`,
        color: "light-blue",
        fill: "solid",
      }),
      geoShape(context, {
        key: `answer-${index + 1}`,
        x: 600,
        y,
        width: 580,
        height: 190,
        text: `Answer ${index + 1}\nExplain the answer in your own words and add one example.`,
        color: index === 1 ? "light-violet" : "light-green",
        fill: "solid",
      }),
    );
  }
  return shapes;
}

const studyKitBuilders: Record<StudyKitId, (context: ShapeContext) => StudyShape[]> = {
  "cornell-notes": buildCornellNotes,
  "concept-map": buildConceptMap,
  "study-planner": buildStudyPlanner,
  "recall-cards": buildRecallCards,
};

function getStudyKit(id: StudyKitId): StudyKitDefinition {
  const kit = STUDY_KITS.find((candidate) => candidate.id === id);
  if (!kit) throw new Error(`Unknown study kit: ${id}`);
  return kit;
}

export function createStudyToolInstanceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildStudyKit(
  id: StudyKitId,
  options: Readonly<{ center: StudyPoint; instanceId: string }>,
): StudyKitBuildResult {
  const kit = getStudyKit(id);
  const origin = {
    x: Math.round(options.center.x - kit.width / 2),
    y: Math.round(options.center.y - kit.height / 2),
  };
  const context: ShapeContext = {
    toolId: id,
    instanceId: options.instanceId,
    origin,
  };
  const shapes = studyKitBuilders[id](context);
  return {
    kit,
    origin,
    shapeIds: shapes.map((shape) => shape.id),
    shapes,
  };
}

function insertNativeShapes(
  editor: StudyEditor | null,
  input: Readonly<{
    name: string;
    shapes: readonly StudyShape[];
    shapeIds: readonly TLShapeId[];
    zoomToSelection: boolean;
  }>,
): StudyToolInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };

  const historyMark = editor.markHistoryStoppingPoint(`Insert ${input.name}`);
  try {
    editor.run(
      () => {
        editor.createShapes([...input.shapes]);
        editor.select(...input.shapeIds);
      },
      { history: "record" },
    );
  } catch {
    editor.bailToMark(historyMark);
    return { ok: false, reason: "capacity" };
  }
  if (input.shapeIds.some((shapeId) => !editor.getShape(shapeId))) {
    editor.bailToMark(historyMark);
    return { ok: false, reason: "capacity" };
  }
  editor.squashToMark(historyMark);
  if (input.zoomToSelection) {
    editor.zoomToSelection({ animation: { duration: 220 } });
  }
  return { ok: true, name: input.name, shapeIds: input.shapeIds };
}

export function insertStudyKit(
  editor: StudyEditor | null,
  id: StudyKitId,
  instanceId = createStudyToolInstanceId(),
): StudyToolInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };
  const viewport = editor.getViewportPageBounds();
  const built = buildStudyKit(id, {
    center: { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h / 2 },
    instanceId,
  });
  return insertNativeShapes(editor, {
    name: built.kit.name,
    shapes: built.shapes,
    shapeIds: built.shapeIds,
    zoomToSelection: true,
  });
}

export function insertCalculationCard(
  editor: StudyEditor | null,
  calculation: Extract<StudyCalculationResult, { ok: true }>,
  instanceId = createStudyToolInstanceId(),
): StudyToolInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };
  const validated = calculateStudyExpression(calculation.expression);
  if (!validated.ok) return { ok: false, reason: "invalid-calculation" };
  const viewport = editor.getViewportPageBounds();
  const width = Math.min(460, Math.max(260, viewport.w * 0.52));
  const height = 210;
  const origin = {
    x: Math.round(viewport.x + viewport.w / 2 - width / 2),
    y: Math.round(viewport.y + viewport.h / 2 - height / 2),
  };
  const context: ShapeContext = {
    toolId: "calculator",
    instanceId,
    origin,
  };
  const card = geoShape(context, {
    key: "result",
    x: 0,
    y: 0,
    width,
    height,
    text: `Calculation\n${validated.expression.replaceAll(/\s+/g, " ")}\n= ${validated.display}`,
    color: "light-blue",
    fill: "solid",
    size: "l",
    verticalAlign: "middle",
  });
  return insertNativeShapes(editor, {
    name: "Calculation",
    shapes: [card],
    shapeIds: [card.id],
    zoomToSelection: false,
  });
}

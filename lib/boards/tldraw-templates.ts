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

export const FABRIC_TEMPLATE_IDS = [
  "brainstorm",
  "customer-journey",
  "kanban",
  "swot",
] as const;

export type FabricTemplateId = (typeof FABRIC_TEMPLATE_IDS)[number];

export type FabricTemplateDefinition = Readonly<{
  id: FabricTemplateId;
  name: string;
  description: string;
  width: number;
  height: number;
}>;

export const FABRIC_TEMPLATES: readonly FabricTemplateDefinition[] = [
  {
    id: "brainstorm",
    name: "Brainstorm Map",
    description: "Develop one challenge into signals, ideas, and a testable next step.",
    width: 1_120,
    height: 700,
  },
  {
    id: "customer-journey",
    name: "Customer Journey",
    description: "Map actions, mindset, and opportunities across five customer stages.",
    width: 1_320,
    height: 760,
  },
  {
    id: "kanban",
    name: "Project Kanban",
    description: "Move clear, editable work items from backlog through completion.",
    width: 1_240,
    height: 720,
  },
  {
    id: "swot",
    name: "SWOT Analysis",
    description: "Compare internal strengths and weaknesses with external opportunities and threats.",
    width: 1_160,
    height: 740,
  },
] as const;

type FabricTemplateShape = TLShapePartial<TLArrowShape | TLGeoShape | TLTextShape>;

type TemplatePoint = Readonly<{ x: number; y: number }>;

export type FabricTemplateBuildOptions = Readonly<{
  center: TemplatePoint;
  instanceId: string;
}>;

export type FabricTemplateBuildResult = Readonly<{
  template: FabricTemplateDefinition;
  origin: TemplatePoint;
  shapeIds: readonly TLShapeId[];
  shapes: readonly FabricTemplateShape[];
}>;

export type FabricTemplateInsertionResult =
  | Readonly<{
      ok: true;
      template: FabricTemplateDefinition;
      shapeIds: readonly TLShapeId[];
    }>
  | Readonly<{
      ok: false;
      reason: "editor-unavailable" | "readonly";
    }>;

type TemplateEditor = Pick<
  Editor,
  | "createShapes"
  | "getInstanceState"
  | "getViewportPageBounds"
  | "markHistoryStoppingPoint"
  | "run"
  | "select"
  | "squashToMark"
  | "zoomToSelection"
>;

type ShapeContext = Readonly<{
  templateId: FabricTemplateId;
  instanceId: string;
  origin: TemplatePoint;
}>;

const getTemplateDefinition = (templateId: FabricTemplateId) => {
  const template = FABRIC_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error(`Unknown Fabric template: ${templateId}`);
  return template;
};

const normalizeIdSegment = (value: string) => {
  const normalized = value.replaceAll(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  return normalized || "instance";
};

const shapeId = (context: ShapeContext, key: string) =>
  createShapeId(
    `fabric-${context.templateId}-${normalizeIdSegment(context.instanceId)}-${normalizeIdSegment(key)}`,
  );

const shapeMeta = (context: ShapeContext, key: string) => ({
  fabricTemplateId: context.templateId,
  fabricTemplateInstanceId: context.instanceId,
  fabricTemplateKey: key,
});

const textShape = (
  context: ShapeContext,
  key: string,
  x: number,
  y: number,
  width: number,
  text: string,
  size: "s" | "m" | "l" | "xl" = "m",
): TLShapePartial<TLTextShape> => ({
  id: shapeId(context, key),
  type: "text",
  x: context.origin.x + x,
  y: context.origin.y + y,
  meta: shapeMeta(context, key),
  props: {
    autoSize: false,
    color: "black",
    font: "sans",
    richText: toRichText(text),
    scale: 1,
    size,
    textAlign: "start",
    w: width,
  },
});

const geoShape = (
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
): TLShapePartial<TLGeoShape> => ({
  id: shapeId(context, options.key),
  type: "geo",
  x: context.origin.x + options.x,
  y: context.origin.y + options.y,
  meta: shapeMeta(context, options.key),
  props: {
    align: options.align ?? "middle",
    color: options.color ?? "blue",
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
    verticalAlign: options.verticalAlign ?? "middle",
    w: options.width,
  },
});

const arrowShape = (
  context: ShapeContext,
  options: Readonly<{
    key: string;
    start: TemplatePoint;
    end: TemplatePoint;
    color?: TLDefaultColorStyle;
  }>,
): TLShapePartial<TLArrowShape> => ({
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
});

const buildBrainstorm = (context: ShapeContext): FabricTemplateShape[] => [
  arrowShape(context, {
    key: "connection-customer-need",
    start: { x: 455, y: 320 },
    end: { x: 310, y: 220 },
  }),
  arrowShape(context, {
    key: "connection-signals",
    start: { x: 665, y: 320 },
    end: { x: 810, y: 220 },
  }),
  arrowShape(context, {
    key: "connection-ideas",
    start: { x: 455, y: 380 },
    end: { x: 310, y: 555 },
  }),
  arrowShape(context, {
    key: "connection-experiment",
    start: { x: 665, y: 380 },
    end: { x: 810, y: 555 },
  }),
  geoShape(context, {
    key: "customer-need",
    x: 50,
    y: 150,
    width: 260,
    height: 140,
    text: "Customer Need\nWhat problem matters most?",
    color: "light-blue",
  }),
  geoShape(context, {
    key: "signals",
    x: 810,
    y: 150,
    width: 260,
    height: 140,
    text: "Signals\nWhat have we learned?",
    color: "yellow",
  }),
  geoShape(context, {
    key: "ideas",
    x: 50,
    y: 500,
    width: 260,
    height: 140,
    text: "Ideas\nWhat could we try?",
    color: "light-green",
  }),
  geoShape(context, {
    key: "next-experiment",
    x: 810,
    y: 500,
    width: 260,
    height: 140,
    text: "Next Experiment\nWhat proves value fastest?",
    color: "light-violet",
  }),
  geoShape(context, {
    key: "challenge",
    x: 440,
    y: 280,
    width: 240,
    height: 140,
    text: "Core Challenge",
    color: "blue",
    fill: "solid",
    geo: "ellipse",
    labelColor: "white",
    size: "l",
  }),
  textShape(context, "title", 0, 0, 760, "Brainstorm Map", "xl"),
  textShape(
    context,
    "subtitle",
    0,
    58,
    820,
    "Start with the challenge, then turn evidence into a focused experiment.",
    "m",
  ),
];

const customerJourneyStages = ["Discover", "Evaluate", "Decide", "Onboard", "Grow"] as const;
const customerJourneyRows = [
  {
    id: "actions",
    name: "Customer Actions",
    color: "light-blue" as const,
    cells: [
      "Search and ask peers",
      "Compare the shortlist",
      "Build internal support",
      "Complete the first task",
      "Share and expand usage",
    ],
  },
  {
    id: "mindset",
    name: "Mindset",
    color: "yellow" as const,
    cells: [
      "Is this worth exploring?",
      "Will this fit our workflow?",
      "Can we trust this choice?",
      "How quickly can I learn?",
      "Is value compounding?",
    ],
  },
  {
    id: "opportunity",
    name: "Opportunity",
    color: "light-green" as const,
    cells: [
      "Clarify the promise",
      "Prove the differentiator",
      "Reduce decision risk",
      "Create an early win",
      "Reveal the next use case",
    ],
  },
] as const;

const buildCustomerJourney = (context: ShapeContext): FabricTemplateShape[] => {
  const shapes: FabricTemplateShape[] = [
    textShape(context, "title", 0, 0, 760, "Customer Journey", "xl"),
    textShape(
      context,
      "subtitle",
      0,
      58,
      920,
      "Capture what customers do, think, and need across the full relationship.",
      "m",
    ),
  ];
  const columnX = (index: number) => 200 + index * 224;

  customerJourneyStages.forEach((stage, index) => {
    shapes.push(
      geoShape(context, {
        key: `stage-${index + 1}`,
        x: columnX(index),
        y: 118,
        width: 204,
        height: 72,
        text: `${index + 1}. ${stage}`,
        color: "blue",
        fill: "solid",
        labelColor: "white",
      }),
    );
  });

  customerJourneyRows.forEach((row, rowIndex) => {
    const y = 210 + rowIndex * 174;
    shapes.push(
      geoShape(context, {
        key: `row-${row.id}`,
        x: 0,
        y,
        width: 180,
        height: 154,
        text: row.name,
        color: "grey",
        fill: "semi",
        align: "start",
      }),
    );
    row.cells.forEach((cell, columnIndex) => {
      shapes.push(
        geoShape(context, {
          key: `${row.id}-${columnIndex + 1}`,
          x: columnX(columnIndex),
          y,
          width: 204,
          height: 154,
          text: cell,
          color: row.color,
          fill: "semi",
          align: "start",
          verticalAlign: "start",
        }),
      );
    });
  });

  return shapes;
};

const kanbanColumns = [
  {
    id: "backlog",
    name: "Backlog",
    color: "grey" as const,
    tasks: ["Validate the problem", "Collect customer evidence", "Define success measure"],
  },
  {
    id: "in-progress",
    name: "In Progress",
    color: "light-blue" as const,
    tasks: ["Build the core flow", "Test with five customers"],
  },
  {
    id: "review",
    name: "Review",
    color: "yellow" as const,
    tasks: ["Resolve launch feedback", "Confirm analytics events"],
  },
  {
    id: "done",
    name: "Done",
    color: "light-green" as const,
    tasks: ["Align the release scope", "Publish the team brief"],
  },
] as const;

const buildKanban = (context: ShapeContext): FabricTemplateShape[] => {
  const shapes: FabricTemplateShape[] = [];
  const columnX = (index: number) => index * 310;

  kanbanColumns.forEach((column, columnIndex) => {
    const x = columnX(columnIndex);
    shapes.push(
      geoShape(context, {
        key: `column-${column.id}`,
        x,
        y: 118,
        width: 280,
        height: 568,
        color: column.color,
        fill: "semi",
      }),
    );
    shapes.push(
      geoShape(context, {
        key: `header-${column.id}`,
        x: x + 14,
        y: 134,
        width: 252,
        height: 62,
        text: `${column.name}  ·  ${column.tasks.length}`,
        color: columnIndex === 1 ? "blue" : column.color,
        fill: "solid",
        labelColor: columnIndex === 1 ? "white" : "black",
        align: "start",
      }),
    );
    column.tasks.forEach((task, taskIndex) => {
      shapes.push(
        geoShape(context, {
          key: `${column.id}-task-${taskIndex + 1}`,
          x: x + 14,
          y: 216 + taskIndex * 128,
          width: 252,
          height: 104,
          text: task,
          color: column.color,
          fill: "solid",
          labelColor: "black",
          align: "start",
          verticalAlign: "start",
        }),
      );
    });
  });

  shapes.push(
    textShape(context, "title", 0, 0, 760, "Project Kanban", "xl"),
    textShape(
      context,
      "subtitle",
      0,
      58,
      820,
      "Keep work visible, limit what is in progress, and finish before starting more.",
      "m",
    ),
  );
  return shapes;
};

const swotQuadrants = [
  {
    id: "strengths",
    name: "Strengths",
    prompt: "Internal advantages",
    color: "light-green" as const,
    x: 0,
    y: 126,
    items: ["What do customers value?", "Where do we outperform?", "What is hard to copy?"],
  },
  {
    id: "weaknesses",
    name: "Weaknesses",
    prompt: "Internal constraints",
    color: "light-red" as const,
    x: 590,
    y: 126,
    items: ["Where do we lose time?", "Which capability is missing?", "What creates avoidable risk?"],
  },
  {
    id: "opportunities",
    name: "Opportunities",
    prompt: "External openings",
    color: "light-blue" as const,
    x: 0,
    y: 436,
    items: ["Which need is underserved?", "What trend can we use?", "Where can we expand?"],
  },
  {
    id: "threats",
    name: "Threats",
    prompt: "External pressures",
    color: "yellow" as const,
    x: 590,
    y: 436,
    items: ["What could change demand?", "Who could move faster?", "Which dependency is fragile?"],
  },
] as const;

const buildSwot = (context: ShapeContext): FabricTemplateShape[] => {
  const shapes: FabricTemplateShape[] = [];
  swotQuadrants.forEach((quadrant) => {
    shapes.push(
      geoShape(context, {
        key: `quadrant-${quadrant.id}`,
        x: quadrant.x,
        y: quadrant.y,
        width: 570,
        height: 284,
        color: quadrant.color,
        fill: "semi",
      }),
      geoShape(context, {
        key: `header-${quadrant.id}`,
        x: quadrant.x + 16,
        y: quadrant.y + 16,
        width: 538,
        height: 70,
        text: `${quadrant.name}\n${quadrant.prompt}`,
        color: quadrant.color,
        fill: "solid",
        align: "start",
      }),
    );
    quadrant.items.forEach((item, itemIndex) => {
      shapes.push(
        geoShape(context, {
          key: `${quadrant.id}-prompt-${itemIndex + 1}`,
          x: quadrant.x + 16 + itemIndex * 178,
          y: quadrant.y + 104,
          width: 164,
          height: 158,
          text: item,
          color: quadrant.color,
          fill: "solid",
          align: "start",
          verticalAlign: "start",
        }),
      );
    });
  });
  shapes.push(
    textShape(context, "title", 0, 0, 760, "SWOT Analysis", "xl"),
    textShape(
      context,
      "subtitle",
      0,
      58,
      900,
      "Separate internal realities from external change before choosing a strategy.",
      "m",
    ),
  );
  return shapes;
};

const templateBuilders: Record<
  FabricTemplateId,
  (context: ShapeContext) => FabricTemplateShape[]
> = {
  brainstorm: buildBrainstorm,
  "customer-journey": buildCustomerJourney,
  kanban: buildKanban,
  swot: buildSwot,
};

export function buildFabricTemplate(
  templateId: FabricTemplateId,
  options: FabricTemplateBuildOptions,
): FabricTemplateBuildResult {
  const template = getTemplateDefinition(templateId);
  const origin = {
    x: Math.round(options.center.x - template.width / 2),
    y: Math.round(options.center.y - template.height / 2),
  };
  const context: ShapeContext = {
    templateId,
    instanceId: options.instanceId,
    origin,
  };
  const shapes = templateBuilders[templateId](context);

  return {
    template,
    origin,
    shapeIds: shapes.map((shape) => shape.id),
    shapes,
  };
}

export function createFabricTemplateInstanceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function insertFabricTemplate(
  editor: TemplateEditor | null,
  templateId: FabricTemplateId,
  instanceId = createFabricTemplateInstanceId(),
): FabricTemplateInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };

  const viewport = editor.getViewportPageBounds();
  const built = buildFabricTemplate(templateId, {
    center: {
      x: viewport.x + viewport.w / 2,
      y: viewport.y + viewport.h / 2,
    },
    instanceId,
  });
  const historyMark = editor.markHistoryStoppingPoint(`Insert ${built.template.name}`);

  editor.run(
    () => {
      editor.createShapes([...built.shapes]);
      editor.select(...built.shapeIds);
    },
    { history: "record" },
  );
  editor.squashToMark(historyMark);
  editor.zoomToSelection({ animation: { duration: 220 } });

  return {
    ok: true,
    template: built.template,
    shapeIds: built.shapeIds,
  };
}

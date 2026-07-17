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

export const EDUCATION_TEMPLATE_IDS = [
  "lesson-plan",
  "kwl-chart",
  "vocabulary-map",
  "lab-report",
  "revision-timetable",
  "comparison-diagram",
] as const;

export type EducationTemplateId = (typeof EDUCATION_TEMPLATE_IDS)[number];

export type EducationTemplateDefinition = Readonly<{
  id: EducationTemplateId;
  name: string;
  description: string;
  width: number;
  height: number;
}>;

export const EDUCATION_TEMPLATES: readonly EducationTemplateDefinition[] = [
  {
    id: "lesson-plan",
    name: "Lesson Plan",
    description: "Plan an objective, learning sequence, assessment, materials, and next steps.",
    width: 1_240,
    height: 820,
  },
  {
    id: "kwl-chart",
    name: "KWL Chart",
    description: "Track what learners know, want to know, and learned during a topic.",
    width: 1_260,
    height: 760,
  },
  {
    id: "vocabulary-map",
    name: "Vocabulary Map",
    description: "Connect a term to its definition, related words, examples, and non-examples.",
    width: 1_180,
    height: 760,
  },
  {
    id: "lab-report",
    name: "Lab Report",
    description: "Organize a question, hypothesis, method, observations, analysis, and conclusion.",
    width: 1_280,
    height: 900,
  },
  {
    id: "revision-timetable",
    name: "Revision Timetable",
    description: "Plan focused review, practice, and recall sessions across a full week.",
    width: 1_460,
    height: 820,
  },
  {
    id: "comparison-diagram",
    name: "Comparison Diagram",
    description: "Separate two topics into differences, similarities, and a final synthesis.",
    width: 1_240,
    height: 760,
  },
] as const;

type EducationTemplateShape = TLShapePartial<TLArrowShape | TLGeoShape | TLTextShape>;
type EducationPoint = Readonly<{ x: number; y: number }>;
type EducationShapeRole = "connector" | "field" | "instruction" | "schedule" | "title";

type EducationEditor = Pick<
  Editor,
  | "bailToMark"
  | "createShapes"
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
  templateId: EducationTemplateId;
  instanceId: string;
  origin: EducationPoint;
}>;

export type EducationTemplateBuildOptions = Readonly<{
  center: EducationPoint;
  instanceId: string;
}>;

export type EducationTemplateBuildResult = Readonly<{
  template: EducationTemplateDefinition;
  origin: EducationPoint;
  shapeIds: readonly TLShapeId[];
  shapes: readonly EducationTemplateShape[];
}>;

export type EducationTemplateInsertionResult =
  | Readonly<{
      ok: true;
      template: EducationTemplateDefinition;
      shapeIds: readonly TLShapeId[];
    }>
  | Readonly<{
      ok: false;
      reason: "capacity" | "editor-unavailable" | "readonly";
    }>;

const normalizeIdSegment = (value: string) =>
  value.replaceAll(/[^a-zA-Z0-9_-]/g, "-").replaceAll(/-+/g, "-").slice(0, 72) || "item";

const normalizeLabel = (value: string) =>
  value.replaceAll(/\s+/g, " ").trim().slice(0, 160) || "Education template object";

const normalizeProvenance = (value: string) => value.trim().slice(0, 160) || "education-template";

const getEducationTemplate = (templateId: EducationTemplateId) => {
  const template = EDUCATION_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) throw new Error(`Unknown education template: ${templateId}`);
  return template;
};

const shapeId = (context: ShapeContext, key: string) =>
  createShapeId(
    `fabric-education-${normalizeIdSegment(context.templateId)}-${normalizeIdSegment(context.instanceId)}-${normalizeIdSegment(key)}`,
  );

const shapeMeta = (
  context: ShapeContext,
  options: Readonly<{ key: string; label: string; role: EducationShapeRole }>,
) => ({
  fabricEducationTemplateId: context.templateId,
  fabricEducationInstanceId: normalizeProvenance(context.instanceId),
  fabricEducationKey: options.key,
  fabricEducationLabel: normalizeLabel(options.label),
  fabricEducationRole: options.role,
});

function textShape(
  context: ShapeContext,
  options: Readonly<{
    key: string;
    x: number;
    y: number;
    width: number;
    text: string;
    label?: string;
    role?: Extract<EducationShapeRole, "instruction" | "title">;
    size?: "s" | "m" | "l" | "xl";
  }>,
): TLShapePartial<TLTextShape> {
  return {
    id: shapeId(context, options.key),
    type: "text",
    x: context.origin.x + options.x,
    y: context.origin.y + options.y,
    meta: shapeMeta(context, {
      key: options.key,
      label: options.label ?? options.text,
      role: options.role ?? "instruction",
    }),
    props: {
      autoSize: false,
      color: "black",
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
    text: string;
    label?: string;
    role?: Extract<EducationShapeRole, "field" | "schedule">;
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
    meta: shapeMeta(context, {
      key: options.key,
      label: options.label ?? options.text,
      role: options.role ?? "field",
    }),
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
      richText: toRichText(options.text),
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
    start: EducationPoint;
    end: EducationPoint;
    label: string;
    color?: TLDefaultColorStyle;
  }>,
): TLShapePartial<TLArrowShape> {
  return {
    id: shapeId(context, options.key),
    type: "arrow",
    x: context.origin.x + options.start.x,
    y: context.origin.y + options.start.y,
    meta: shapeMeta(context, {
      key: options.key,
      label: options.label,
      role: "connector",
    }),
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

const buildLessonPlan = (context: ShapeContext): EducationTemplateShape[] => [
  textShape(context, {
    key: "title",
    x: 0,
    y: 0,
    width: 760,
    text: "Lesson Plan",
    label: "Lesson Plan title",
    role: "title",
    size: "xl",
  }),
  textShape(context, {
    key: "subtitle",
    x: 0,
    y: 56,
    width: 1_100,
    text: "Subject: ____________________    Class: __________    Date: __________    Duration: __________",
    label: "Lesson details",
  }),
  geoShape(context, {
    key: "learning-objective",
    x: 0,
    y: 112,
    width: 1_240,
    height: 120,
    text: "Learning Objective\nBy the end of the lesson, learners will be able to…",
    label: "Learning objective",
    color: "blue",
    fill: "semi",
    size: "l",
  }),
  geoShape(context, {
    key: "launch",
    x: 0,
    y: 254,
    width: 300,
    height: 270,
    text: "Launch · 10 min\n\nHook or retrieval prompt\n\nWhat prior knowledge should surface?",
    label: "Lesson launch",
    color: "yellow",
  }),
  geoShape(context, {
    key: "explore",
    x: 320,
    y: 254,
    width: 600,
    height: 270,
    text: "Explore · 30 min\n\nModel the key idea, then let learners practice, discuss, create, or investigate.\n\nChecks for understanding:",
    label: "Main learning activity",
    color: "light-blue",
  }),
  geoShape(context, {
    key: "reflect",
    x: 940,
    y: 254,
    width: 300,
    height: 270,
    text: "Reflect · 10 min\n\nExit question\n\nWhat should learners explain in their own words?",
    label: "Lesson reflection",
    color: "light-green",
  }),
  geoShape(context, {
    key: "materials",
    x: 0,
    y: 546,
    width: 400,
    height: 220,
    text: "Materials and Preparation\n\n• Resource\n• Resource\n• Accessibility support",
    label: "Lesson materials and preparation",
    color: "grey",
  }),
  geoShape(context, {
    key: "assessment",
    x: 420,
    y: 546,
    width: 400,
    height: 220,
    text: "Assessment Evidence\n\nWhat will learners say, make, solve, or demonstrate?",
    label: "Assessment evidence",
    color: "light-violet",
  }),
  geoShape(context, {
    key: "next-steps",
    x: 840,
    y: 546,
    width: 400,
    height: 220,
    text: "Adaptation and Next Steps\n\nSupport: ____________________\nStretch: ____________________\nNext lesson: ________________",
    label: "Lesson adaptations and next steps",
    color: "light-green",
  }),
];

const kwlColumns = [
  {
    id: "know",
    title: "K · What I Know",
    prompt: "Add facts, experiences, and ideas you already connect to this topic.\n\n• ____________________\n\n• ____________________\n\n• ____________________",
    color: "light-blue" as const,
  },
  {
    id: "want",
    title: "W · What I Want to Know",
    prompt: "Turn curiosity into questions you can investigate.\n\n• ____________________\n\n• ____________________\n\n• ____________________",
    color: "yellow" as const,
  },
  {
    id: "learned",
    title: "L · What I Learned",
    prompt: "Record new understanding and evidence after learning.\n\n• ____________________\n\n• ____________________\n\n• ____________________",
    color: "light-green" as const,
  },
] as const;

function buildKwlChart(context: ShapeContext): EducationTemplateShape[] {
  const shapes: EducationTemplateShape[] = [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 760,
      text: "KWL Chart",
      label: "KWL Chart title",
      role: "title",
      size: "xl",
    }),
    textShape(context, {
      key: "subtitle",
      x: 0,
      y: 56,
      width: 1_000,
      text: "Use before, during, and after a lesson to make learning progress visible.",
      label: "KWL Chart instructions",
    }),
    geoShape(context, {
      key: "topic",
      x: 0,
      y: 112,
      width: 1_260,
      height: 90,
      text: "Topic or Guiding Question: ________________________________________________",
      label: "KWL topic or guiding question",
      color: "blue",
      fill: "semi",
      verticalAlign: "middle",
      size: "l",
    }),
  ];

  kwlColumns.forEach((column, index) => {
    shapes.push(
      geoShape(context, {
        key: column.id,
        x: index * 430,
        y: 224,
        width: 400,
        height: 470,
        text: `${column.title}\n\n${column.prompt}`,
        label: column.title,
        color: column.color,
      }),
    );
  });
  return shapes;
}

const vocabularyBranches = [
  {
    id: "definition",
    title: "Definition",
    prompt: "Explain the meaning in your own words.",
    x: 0,
    y: 140,
    color: "light-blue" as const,
    target: { x: 310, y: 235 },
  },
  {
    id: "related-words",
    title: "Related Words",
    prompt: "Add synonyms, roots, or connected terms.",
    x: 870,
    y: 140,
    color: "light-violet" as const,
    target: { x: 870, y: 235 },
  },
  {
    id: "examples",
    title: "Examples",
    prompt: "Show the word in context or draw an example.",
    x: 0,
    y: 520,
    color: "light-green" as const,
    target: { x: 310, y: 610 },
  },
  {
    id: "non-examples",
    title: "Non-Examples",
    prompt: "Clarify what the word does not mean.",
    x: 870,
    y: 520,
    color: "yellow" as const,
    target: { x: 870, y: 610 },
  },
] as const;

function buildVocabularyMap(context: ShapeContext): EducationTemplateShape[] {
  const center = { x: 590, y: 390 };
  const shapes: EducationTemplateShape[] = [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 760,
      text: "Vocabulary Map",
      label: "Vocabulary Map title",
      role: "title",
      size: "xl",
    }),
    textShape(context, {
      key: "subtitle",
      x: 0,
      y: 56,
      width: 1_000,
      text: "Build a precise, memorable understanding of one important term.",
      label: "Vocabulary Map instructions",
    }),
  ];

  vocabularyBranches.forEach((branch) => {
    shapes.push(
      arrowShape(context, {
        key: `connection-${branch.id}`,
        start: center,
        end: branch.target,
        label: `Connection from key term to ${branch.title}`,
      }),
    );
  });
  shapes.push(
    geoShape(context, {
      key: "key-term",
      x: 415,
      y: 285,
      width: 350,
      height: 210,
      text: "KEY TERM\n\nWrite the word here",
      label: "Key vocabulary term",
      color: "blue",
      fill: "solid",
      geo: "ellipse",
      labelColor: "white",
      align: "middle",
      verticalAlign: "middle",
      size: "l",
    }),
  );
  vocabularyBranches.forEach((branch) => {
    shapes.push(
      geoShape(context, {
        key: branch.id,
        x: branch.x,
        y: branch.y,
        width: 310,
        height: 180,
        text: `${branch.title}\n\n${branch.prompt}`,
        label: branch.title,
        color: branch.color,
        fill: "solid",
      }),
    );
  });
  return shapes;
}

const buildLabReport = (context: ShapeContext): EducationTemplateShape[] => [
  textShape(context, {
    key: "title",
    x: 0,
    y: 0,
    width: 760,
    text: "Lab Report",
    label: "Lab Report title",
    role: "title",
    size: "xl",
  }),
  textShape(context, {
    key: "subtitle",
    x: 0,
    y: 56,
    width: 1_100,
    text: "Investigation: ____________________    Name: ____________________    Date: __________",
    label: "Lab report details",
  }),
  geoShape(context, {
    key: "question",
    x: 0,
    y: 112,
    width: 620,
    height: 130,
    text: "Question\nWhat are you investigating or measuring?",
    label: "Investigation question",
    color: "light-blue",
    fill: "solid",
  }),
  geoShape(context, {
    key: "hypothesis",
    x: 660,
    y: 112,
    width: 620,
    height: 130,
    text: "Hypothesis\nIf ____________________, then ____________________, because ____________________.",
    label: "Investigation hypothesis",
    color: "light-violet",
    fill: "solid",
  }),
  geoShape(context, {
    key: "materials",
    x: 0,
    y: 264,
    width: 310,
    height: 270,
    text: "Materials and Safety\n\n• Equipment\n• Materials\n• Safety controls",
    label: "Materials and safety",
    color: "yellow",
  }),
  geoShape(context, {
    key: "variables",
    x: 330,
    y: 264,
    width: 310,
    height: 270,
    text: "Variables\n\nChange: __________\nMeasure: _________\nKeep the same: ____",
    label: "Investigation variables",
    color: "grey",
  }),
  geoShape(context, {
    key: "method",
    x: 660,
    y: 264,
    width: 620,
    height: 270,
    text: "Method\n\n1. ______________________________\n\n2. ______________________________\n\n3. ______________________________",
    label: "Investigation method",
    color: "light-blue",
  }),
  geoShape(context, {
    key: "observations",
    x: 0,
    y: 558,
    width: 620,
    height: 280,
    text: "Observations and Results\n\nRecord measurements, patterns, unexpected events, and a chart or sketch.",
    label: "Observations and results",
    color: "light-green",
  }),
  geoShape(context, {
    key: "analysis",
    x: 660,
    y: 558,
    width: 300,
    height: 280,
    text: "Analysis\n\nWhat pattern do the results show?\n\nWhat evidence supports it?",
    label: "Results analysis",
    color: "yellow",
  }),
  geoShape(context, {
    key: "conclusion",
    x: 980,
    y: 558,
    width: 300,
    height: 280,
    text: "Conclusion\n\nAnswer the question. Evaluate the hypothesis and suggest one improvement.",
    label: "Investigation conclusion",
    color: "light-violet",
  }),
];

const revisionDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const revisionSessions = [
  {
    id: "morning",
    name: "Morning",
    prompt: "Subject:\nRecall task:\nDone: □",
    color: "light-blue" as const,
  },
  {
    id: "afternoon",
    name: "After School",
    prompt: "Subject:\nPractice task:\nDone: □",
    color: "yellow" as const,
  },
  {
    id: "evening",
    name: "Evening",
    prompt: "Subject:\nReview + next step:\nDone: □",
    color: "light-green" as const,
  },
] as const;

function buildRevisionTimetable(context: ShapeContext): EducationTemplateShape[] {
  const shapes: EducationTemplateShape[] = [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 760,
      text: "Revision Timetable",
      label: "Revision Timetable title",
      role: "title",
      size: "xl",
    }),
    textShape(context, {
      key: "subtitle",
      x: 0,
      y: 56,
      width: 1_100,
      text: "Balance recall, practice, breaks, and sleep. Keep each session specific and achievable.",
      label: "Revision Timetable instructions",
    }),
    geoShape(context, {
      key: "weekly-goal",
      x: 0,
      y: 104,
      width: 1_460,
      height: 90,
      text: "Weekly Goal: By Sunday, I will be able to ________________________________________________",
      label: "Weekly revision goal",
      color: "blue",
      fill: "semi",
      verticalAlign: "middle",
      size: "l",
    }),
  ];

  revisionDays.forEach((day, dayIndex) => {
    shapes.push(
      geoShape(context, {
        key: `day-${day.toLowerCase()}`,
        x: 170 + dayIndex * 182,
        y: 214,
        width: 174,
        height: 64,
        text: day,
        label: `${day} timetable column`,
        role: "schedule",
        color: "blue",
        fill: "solid",
        labelColor: "white",
        align: "middle",
        verticalAlign: "middle",
      }),
    );
  });

  revisionSessions.forEach((session, sessionIndex) => {
    const y = 296 + sessionIndex * 160;
    shapes.push(
      geoShape(context, {
        key: `session-${session.id}`,
        x: 0,
        y,
        width: 150,
        height: 142,
        text: session.name,
        label: `${session.name} session row`,
        role: "schedule",
        color: session.color,
        fill: "solid",
        align: "middle",
        verticalAlign: "middle",
      }),
    );
    revisionDays.forEach((day, dayIndex) => {
      shapes.push(
        geoShape(context, {
          key: `${day.toLowerCase()}-${session.id}`,
          x: 170 + dayIndex * 182,
          y,
          width: 174,
          height: 142,
          text: session.prompt,
          label: `${day} ${session.name} revision session`,
          role: "schedule",
          color: session.color,
          fill: "semi",
          size: "s",
        }),
      );
    });
  });
  return shapes;
}

const buildComparisonDiagram = (context: ShapeContext): EducationTemplateShape[] => [
  textShape(context, {
    key: "title",
    x: 0,
    y: 0,
    width: 760,
    text: "Comparison Diagram",
    label: "Comparison Diagram title",
    role: "title",
    size: "xl",
  }),
  textShape(context, {
    key: "subtitle",
    x: 0,
    y: 56,
    width: 1_100,
    text: "Compare two topics using the same criteria, then explain the most important insight.",
    label: "Comparison Diagram instructions",
  }),
  geoShape(context, {
    key: "topic-a",
    x: 0,
    y: 112,
    width: 380,
    height: 88,
    text: "Topic A: ____________________",
    label: "First comparison topic",
    color: "blue",
    fill: "solid",
    labelColor: "white",
    verticalAlign: "middle",
    size: "l",
  }),
  geoShape(context, {
    key: "criteria",
    x: 410,
    y: 112,
    width: 420,
    height: 88,
    text: "Criteria: purpose · structure · evidence · impact",
    label: "Comparison criteria",
    color: "grey",
    fill: "semi",
    align: "middle",
    verticalAlign: "middle",
  }),
  geoShape(context, {
    key: "topic-b",
    x: 860,
    y: 112,
    width: 380,
    height: 88,
    text: "Topic B: ____________________",
    label: "Second comparison topic",
    color: "blue",
    fill: "solid",
    labelColor: "white",
    verticalAlign: "middle",
    size: "l",
  }),
  geoShape(context, {
    key: "only-a",
    x: 0,
    y: 224,
    width: 380,
    height: 390,
    text: "Only Topic A\n\n• Distinct feature\n\n• Evidence or example\n\n• Why it matters",
    label: "Differences unique to Topic A",
    color: "light-blue",
    fill: "solid",
  }),
  geoShape(context, {
    key: "both",
    x: 410,
    y: 224,
    width: 420,
    height: 390,
    text: "Both Topics\n\n• Shared feature\n\n• Shared evidence\n\n• Important relationship",
    label: "Similarities shared by both topics",
    color: "light-green",
    fill: "solid",
  }),
  geoShape(context, {
    key: "only-b",
    x: 860,
    y: 224,
    width: 380,
    height: 390,
    text: "Only Topic B\n\n• Distinct feature\n\n• Evidence or example\n\n• Why it matters",
    label: "Differences unique to Topic B",
    color: "light-violet",
    fill: "solid",
  }),
  geoShape(context, {
    key: "synthesis",
    x: 0,
    y: 638,
    width: 1_240,
    height: 90,
    text: "Synthesis: The most important similarity or difference is ____________________ because ____________________.",
    label: "Comparison synthesis",
    color: "yellow",
    fill: "semi",
    verticalAlign: "middle",
    size: "l",
  }),
];

const educationTemplateBuilders: Record<
  EducationTemplateId,
  (context: ShapeContext) => EducationTemplateShape[]
> = {
  "lesson-plan": buildLessonPlan,
  "kwl-chart": buildKwlChart,
  "vocabulary-map": buildVocabularyMap,
  "lab-report": buildLabReport,
  "revision-timetable": buildRevisionTimetable,
  "comparison-diagram": buildComparisonDiagram,
};

export function createEducationTemplateInstanceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildEducationTemplate(
  templateId: EducationTemplateId,
  options: EducationTemplateBuildOptions,
): EducationTemplateBuildResult {
  const template = getEducationTemplate(templateId);
  const origin = {
    x: Math.round(options.center.x - template.width / 2),
    y: Math.round(options.center.y - template.height / 2),
  };
  const context: ShapeContext = {
    templateId,
    instanceId: options.instanceId,
    origin,
  };
  const shapes = educationTemplateBuilders[templateId](context);
  return {
    template,
    origin,
    shapeIds: shapes.map((shape) => shape.id),
    shapes,
  };
}

export function insertEducationTemplate(
  editor: EducationEditor | null,
  templateId: EducationTemplateId,
  instanceId = createEducationTemplateInstanceId(),
): EducationTemplateInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };

  const viewport = editor.getViewportPageBounds();
  const built = buildEducationTemplate(templateId, {
    center: {
      x: viewport.x + viewport.w / 2,
      y: viewport.y + viewport.h / 2,
    },
    instanceId,
  });
  const historyMark = editor.markHistoryStoppingPoint(`Insert ${built.template.name}`);
  try {
    editor.run(
      () => {
        editor.createShapes([...built.shapes]);
        editor.select(...built.shapeIds);
      },
      { history: "record" },
    );
  } catch {
    editor.bailToMark(historyMark);
    return { ok: false, reason: "capacity" };
  }
  if (built.shapeIds.some((id) => !editor.getShape(id))) {
    editor.bailToMark(historyMark);
    return { ok: false, reason: "capacity" };
  }

  editor.squashToMark(historyMark);
  editor.zoomToSelection({ animation: { duration: 220 } });
  return {
    ok: true,
    template: built.template,
    shapeIds: built.shapeIds,
  };
}

import {
  createShapeId,
  toRichText,
  type Editor,
  type TLDefaultColorStyle,
  type TLDrawShape,
  type TLGeoShape,
  type TLShapeId,
  type TLShapePartial,
  type TLTextShape,
} from "tldraw";

import {
  convertStemUnit,
  sampleStemGraph,
  validateStemEquationCard,
  type StemConversionRequest,
  type StemConversionResult,
  type StemEquationCardInput,
  type StemGraphRequest,
  type StemGraphResult,
  type ValidatedStemEquationCard,
} from "./stem-math";

export const STEM_INSTRUMENT_IDS = ["ruler", "protractor", "coordinate-plane"] as const;

export type StemInstrumentId = (typeof STEM_INSTRUMENT_IDS)[number];

export type StemInstrumentDefinition = Readonly<{
  id: StemInstrumentId;
  name: string;
  description: string;
  width: number;
  height: number;
}>;

export const STEM_INSTRUMENTS: readonly StemInstrumentDefinition[] = [
  {
    id: "ruler",
    name: "Ruler",
    description: "Add an editable centimetre ruler for scale drawings and measurement.",
    width: 920,
    height: 230,
  },
  {
    id: "protractor",
    name: "Protractor",
    description: "Add a 180° guide with ten-degree ticks for angle work.",
    width: 920,
    height: 560,
  },
  {
    id: "coordinate-plane",
    name: "Coordinate Plane",
    description: "Add a labelled −10 to 10 grid for plotting points and functions.",
    width: 820,
    height: 780,
  },
] as const;

type StemToolId = StemInstrumentId | "graph" | "equation-card" | "conversion-card";
type StemShape = TLShapePartial<TLDrawShape | TLGeoShape | TLTextShape>;
type StemPoint = Readonly<{ x: number; y: number }>;

type StemEditor = Pick<
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
  toolId: StemToolId;
  instanceId: string;
  origin: StemPoint;
}>;

export type StemToolBuildResult = Readonly<{
  name: string;
  origin: StemPoint;
  width: number;
  height: number;
  shapeIds: readonly TLShapeId[];
  shapes: readonly StemShape[];
}>;

export type StemToolInsertionResult =
  | Readonly<{ ok: true; name: string; shapeIds: readonly TLShapeId[] }>
  | Readonly<{
      ok: false;
      reason: "editor-unavailable" | "readonly" | "capacity" | "invalid-input";
      message?: string;
    }>;

const normalizeIdSegment = (value: string) =>
  value.replaceAll(/[^a-zA-Z0-9_-]/g, "-").replaceAll(/-+/g, "-").slice(0, 72) || "item";

const normalizeProvenance = (value: string) => value.trim().slice(0, 160) || "stem-tool";

const shapeId = (context: ShapeContext, key: string) =>
  createShapeId(
    `fabric-stem-${normalizeIdSegment(context.toolId)}-${normalizeIdSegment(context.instanceId)}-${normalizeIdSegment(key)}`,
  );

const shapeMeta = (context: ShapeContext, key: string) => ({
  fabricStemTool: context.toolId,
  fabricStemInstanceId: normalizeProvenance(context.instanceId),
  fabricStemKey: key,
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
    align?: "end" | "middle" | "start";
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
      textAlign: options.align ?? "start",
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
    size?: "s" | "m" | "l" | "xl";
    align?: "end" | "middle" | "start";
    verticalAlign?: "end" | "middle" | "start";
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
      geo: "rectangle",
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

function drawShape(
  context: ShapeContext,
  options: Readonly<{
    key: string;
    x: number;
    y: number;
    segments: readonly (readonly StemPoint[])[];
    color?: TLDefaultColorStyle;
    size?: "s" | "m" | "l" | "xl";
  }>,
): TLShapePartial<TLDrawShape> {
  return {
    id: shapeId(context, options.key),
    type: "draw",
    x: context.origin.x + options.x,
    y: context.origin.y + options.y,
    meta: shapeMeta(context, options.key),
    props: {
      color: options.color ?? "blue",
      dash: "solid",
      fill: "none",
      isClosed: false,
      isComplete: true,
      isPen: false,
      scale: 1,
      segments: options.segments
        .filter((segment) => segment.length >= 2)
        .map((segment) => ({
          type: "straight" as const,
          points: segment.map((point) => ({ x: point.x, y: point.y, z: 0.5 })),
        })),
      size: options.size ?? "s",
    },
  };
}

function centeredOrigin(center: StemPoint, width: number, height: number): StemPoint {
  return {
    x: Math.round(center.x - width / 2),
    y: Math.round(center.y - height / 2),
  };
}

function finishBuild(
  name: string,
  origin: StemPoint,
  width: number,
  height: number,
  shapes: readonly StemShape[],
): StemToolBuildResult {
  return {
    name,
    origin,
    width,
    height,
    shapes,
    shapeIds: shapes.map((shape) => shape.id),
  };
}

export function createStemToolInstanceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildStemGraph(
  graph: Extract<StemGraphResult, { ok: true }>,
  options: Readonly<{ center: StemPoint; instanceId: string }>,
): StemToolBuildResult {
  const width = 940;
  const height = 700;
  const origin = centeredOrigin(options.center, width, height);
  const context: ShapeContext = { toolId: "graph", instanceId: options.instanceId, origin };
  const plot = { x: 70, y: 132, w: 800, h: 500 };
  const xSpan = graph.xMax - graph.xMin;
  const ySpan = graph.yMax - graph.yMin;
  const mapPoint = (point: StemPoint): StemPoint => ({
    x: ((point.x - graph.xMin) / xSpan) * plot.w,
    y: ((graph.yMax - point.y) / ySpan) * plot.h,
  });

  const gridSegments: StemPoint[][] = [];
  for (let index = 0; index <= 10; index += 1) {
    const x = (plot.w * index) / 10;
    const y = (plot.h * index) / 10;
    gridSegments.push(
      [
        { x, y: 0 },
        { x, y: plot.h },
      ],
      [
        { x: 0, y },
        { x: plot.w, y },
      ],
    );
  }
  const axisSegments: StemPoint[][] = [];
  if (graph.xMin <= 0 && graph.xMax >= 0) {
    const x = ((0 - graph.xMin) / xSpan) * plot.w;
    axisSegments.push([
      { x, y: 0 },
      { x, y: plot.h },
    ]);
  }
  if (graph.yMin <= 0 && graph.yMax >= 0) {
    const y = ((graph.yMax - 0) / ySpan) * plot.h;
    axisSegments.push([
      { x: 0, y },
      { x: plot.w, y },
    ]);
  }

  const shapes: StemShape[] = [
    geoShape(context, {
      key: "card",
      x: 0,
      y: 0,
      width,
      height,
      color: "light-blue",
      fill: "semi",
    }),
    textShape(context, {
      key: "title",
      x: 38,
      y: 28,
      width: 600,
      text: `Graph · y = ${graph.expression}`,
      size: "xl",
    }),
    textShape(context, {
      key: "window",
      x: 40,
      y: 82,
      width: 830,
      text: `Window  x: ${graph.xMin} to ${graph.xMax}   y: ${graph.yMin} to ${graph.yMax}`,
      color: "grey",
      size: "s",
    }),
    geoShape(context, {
      key: "plot",
      x: plot.x,
      y: plot.y,
      width: plot.w,
      height: plot.h,
      color: "grey",
      fill: "semi",
    }),
    drawShape(context, {
      key: "grid",
      x: plot.x,
      y: plot.y,
      segments: gridSegments,
      color: "grey",
      size: "s",
    }),
    drawShape(context, {
      key: "curve",
      x: plot.x,
      y: plot.y,
      segments: graph.segments.map((segment) => segment.map(mapPoint)),
      color: "blue",
      size: "m",
    }),
    textShape(context, {
      key: "x-min",
      x: plot.x - 4,
      y: plot.y + plot.h + 14,
      width: 120,
      text: String(graph.xMin),
      size: "s",
      color: "grey",
    }),
    textShape(context, {
      key: "x-max",
      x: plot.x + plot.w - 116,
      y: plot.y + plot.h + 14,
      width: 120,
      text: String(graph.xMax),
      size: "s",
      color: "grey",
      align: "end",
    }),
  ];
  if (axisSegments.length > 0) {
    shapes.splice(
      5,
      0,
      drawShape(context, {
        key: "axes",
        x: plot.x,
        y: plot.y,
        segments: axisSegments,
        color: "black",
        size: "m",
      }),
    );
  }
  return finishBuild("Function Graph", origin, width, height, shapes);
}

export function buildStemEquationCard(
  card: ValidatedStemEquationCard,
  options: Readonly<{ center: StemPoint; instanceId: string }>,
): StemToolBuildResult {
  const width = 660;
  const height = 300;
  const origin = centeredOrigin(options.center, width, height);
  const context: ShapeContext = {
    toolId: "equation-card",
    instanceId: options.instanceId,
    origin,
  };
  const shape = geoShape(context, {
    key: "card",
    x: 0,
    y: 0,
    width,
    height,
    text: `${card.title}\n\n${card.equation}\n\n${card.note}`,
    color: "light-violet",
    fill: "solid",
    size: "l",
    verticalAlign: "middle",
  });
  return finishBuild("Equation Card", origin, width, height, [shape]);
}

export function buildStemConversionCard(
  conversion: Extract<StemConversionResult, { ok: true }>,
  options: Readonly<{ center: StemPoint; instanceId: string }>,
): StemToolBuildResult {
  const width = 600;
  const height = 250;
  const origin = centeredOrigin(options.center, width, height);
  const context: ShapeContext = {
    toolId: "conversion-card",
    instanceId: options.instanceId,
    origin,
  };
  const shape = geoShape(context, {
    key: "card",
    x: 0,
    y: 0,
    width,
    height,
    text: `Unit Conversion · ${conversion.category}\n\n${conversion.value} ${conversion.from.symbol}  =  ${conversion.display} ${conversion.to.symbol}\n\n${conversion.from.name} to ${conversion.to.name}`,
    color: "light-green",
    fill: "solid",
    size: "l",
    verticalAlign: "middle",
  });
  return finishBuild("Unit Conversion", origin, width, height, [shape]);
}

function buildRuler(context: ShapeContext): StemShape[] {
  const tickSegments: StemPoint[][] = [];
  const labelShapes: StemShape[] = [];
  const startX = 34;
  const usableWidth = 852;
  for (let index = 0; index <= 100; index += 1) {
    const x = startX + (usableWidth * index) / 100;
    const height = index % 10 === 0 ? 48 : index % 5 === 0 ? 34 : 22;
    tickSegments.push([
      { x, y: 82 },
      { x, y: 82 + height },
    ]);
    if (index % 10 === 0) {
      labelShapes.push(
        textShape(context, {
          key: `label-${index / 10}`,
          x: x - 18,
          y: 138,
          width: 36,
          text: String(index / 10),
          size: "s",
          align: "middle",
        }),
      );
    }
  }
  return [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 500,
      text: "Centimetre Ruler",
      size: "l",
    }),
    geoShape(context, {
      key: "body",
      x: 0,
      y: 62,
      width: 920,
      height: 150,
      color: "yellow",
      fill: "semi",
    }),
    drawShape(context, {
      key: "ticks",
      x: 0,
      y: 0,
      segments: tickSegments,
      color: "black",
      size: "s",
    }),
    ...labelShapes,
    textShape(context, {
      key: "unit",
      x: 836,
      y: 174,
      width: 56,
      text: "cm",
      size: "s",
      color: "grey",
      align: "end",
    }),
  ];
}

function polarPoint(center: StemPoint, radius: number, degrees: number): StemPoint {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y - Math.sin(radians) * radius,
  };
}

function buildProtractor(context: ShapeContext): StemShape[] {
  const center = { x: 460, y: 500 };
  const radius = 380;
  const arc: StemPoint[] = [];
  for (let degree = 0; degree <= 180; degree += 3) {
    arc.push(polarPoint(center, radius, degree));
  }
  const guideSegments: StemPoint[][] = [
    arc,
    [
      { x: center.x - radius, y: center.y },
      { x: center.x + radius, y: center.y },
    ],
  ];
  const labels: StemShape[] = [];
  for (let degree = 0; degree <= 180; degree += 10) {
    const outer = polarPoint(center, radius, degree);
    const inner = polarPoint(center, radius - (degree % 30 === 0 ? 34 : 20), degree);
    guideSegments.push([outer, inner]);
    if (degree % 30 === 0) {
      const label = polarPoint(center, radius - 64, degree);
      labels.push(
        textShape(context, {
          key: `label-${degree}`,
          x: label.x - 28,
          y: label.y - 15,
          width: 56,
          text: `${degree}°`,
          size: "s",
          align: "middle",
        }),
      );
    }
  }
  return [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 500,
      text: "180° Protractor",
      size: "l",
    }),
    geoShape(context, {
      key: "surface",
      x: 58,
      y: 80,
      width: 804,
      height: 460,
      color: "light-blue",
      fill: "semi",
    }),
    drawShape(context, {
      key: "guides",
      x: 0,
      y: 0,
      segments: guideSegments,
      color: "blue",
      size: "s",
    }),
    ...labels,
    geoShape(context, {
      key: "vertex",
      x: center.x - 9,
      y: center.y - 9,
      width: 18,
      height: 18,
      color: "blue",
      fill: "solid",
    }),
  ];
}

function buildCoordinatePlane(context: ShapeContext): StemShape[] {
  const plot = { x: 70, y: 100, w: 680, h: 640 };
  const grid: StemPoint[][] = [];
  for (let index = 0; index <= 20; index += 1) {
    const x = (plot.w * index) / 20;
    const y = (plot.h * index) / 20;
    grid.push(
      [
        { x, y: 0 },
        { x, y: plot.h },
      ],
      [
        { x: 0, y },
        { x: plot.w, y },
      ],
    );
  }
  return [
    textShape(context, {
      key: "title",
      x: 0,
      y: 0,
      width: 500,
      text: "Coordinate Plane · −10 to 10",
      size: "l",
    }),
    geoShape(context, {
      key: "surface",
      x: plot.x,
      y: plot.y,
      width: plot.w,
      height: plot.h,
      color: "grey",
      fill: "semi",
    }),
    drawShape(context, {
      key: "grid",
      x: plot.x,
      y: plot.y,
      segments: grid,
      color: "grey",
      size: "s",
    }),
    drawShape(context, {
      key: "axes",
      x: plot.x,
      y: plot.y,
      segments: [
        [
          { x: plot.w / 2, y: 0 },
          { x: plot.w / 2, y: plot.h },
        ],
        [
          { x: 0, y: plot.h / 2 },
          { x: plot.w, y: plot.h / 2 },
        ],
      ],
      color: "black",
      size: "m",
    }),
    textShape(context, {
      key: "x-labels",
      x: plot.x,
      y: plot.y + plot.h + 12,
      width: plot.w,
      text: "−10                                  0                                  10",
      size: "s",
      color: "grey",
    }),
    textShape(context, {
      key: "y-labels",
      x: plot.x + plot.w + 12,
      y: plot.y - 10,
      width: 60,
      text: "10\n\n\n\n\n\n\n\n\n0\n\n\n\n\n\n\n\n\n−10",
      size: "s",
      color: "grey",
    }),
  ];
}

const instrumentBuilders: Record<StemInstrumentId, (context: ShapeContext) => StemShape[]> = {
  ruler: buildRuler,
  protractor: buildProtractor,
  "coordinate-plane": buildCoordinatePlane,
};

function getInstrument(id: StemInstrumentId): StemInstrumentDefinition {
  const instrument = STEM_INSTRUMENTS.find((candidate) => candidate.id === id);
  if (!instrument) throw new Error(`Unknown STEM instrument: ${id}`);
  return instrument;
}

export function buildStemInstrument(
  id: StemInstrumentId,
  options: Readonly<{ center: StemPoint; instanceId: string }>,
): StemToolBuildResult {
  const instrument = getInstrument(id);
  const origin = centeredOrigin(options.center, instrument.width, instrument.height);
  const context: ShapeContext = { toolId: id, instanceId: options.instanceId, origin };
  return finishBuild(
    instrument.name,
    origin,
    instrument.width,
    instrument.height,
    instrumentBuilders[id](context),
  );
}

function insertNativeShapes(
  editor: StemEditor | null,
  built: StemToolBuildResult,
  zoomToSelection: boolean,
): StemToolInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };
  const historyMark = editor.markHistoryStoppingPoint(`Insert ${built.name}`);
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
  if (zoomToSelection) editor.zoomToSelection({ animation: { duration: 220 } });
  return { ok: true, name: built.name, shapeIds: built.shapeIds };
}

function viewportCenter(editor: StemEditor): StemPoint {
  const viewport = editor.getViewportPageBounds();
  return { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h / 2 };
}

export function insertStemGraph(
  editor: StemEditor | null,
  request: StemGraphRequest,
  instanceId = createStemToolInstanceId(),
): StemToolInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };
  const graph = sampleStemGraph(request);
  if (!graph.ok) return { ok: false, reason: "invalid-input", message: graph.message };
  return insertNativeShapes(
    editor,
    buildStemGraph(graph, { center: viewportCenter(editor), instanceId }),
    true,
  );
}

export function insertStemEquationCard(
  editor: StemEditor | null,
  input: StemEquationCardInput,
  instanceId = createStemToolInstanceId(),
): StemToolInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };
  const validated = validateStemEquationCard(input);
  if (!validated.ok) {
    return { ok: false, reason: "invalid-input", message: validated.message };
  }
  return insertNativeShapes(
    editor,
    buildStemEquationCard(validated.card, { center: viewportCenter(editor), instanceId }),
    false,
  );
}

export function insertStemConversionCard(
  editor: StemEditor | null,
  request: StemConversionRequest,
  instanceId = createStemToolInstanceId(),
): StemToolInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };
  const conversion = convertStemUnit(request);
  if (!conversion.ok) {
    return { ok: false, reason: "invalid-input", message: conversion.message };
  }
  return insertNativeShapes(
    editor,
    buildStemConversionCard(conversion, { center: viewportCenter(editor), instanceId }),
    false,
  );
}

export function insertStemInstrument(
  editor: StemEditor | null,
  id: StemInstrumentId,
  instanceId = createStemToolInstanceId(),
): StemToolInsertionResult {
  if (!editor) return { ok: false, reason: "editor-unavailable" };
  if (editor.getInstanceState().isReadonly) return { ok: false, reason: "readonly" };
  return insertNativeShapes(
    editor,
    buildStemInstrument(id, { center: viewportCenter(editor), instanceId }),
    true,
  );
}

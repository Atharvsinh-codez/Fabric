export const PEN_RENDERER_VERSION = "fabric-dot-pen-v1" as const;

export type PenPoint = Readonly<{ x: number; y: number; z?: number }>;
export type PenSegment = Readonly<{
  type: "free" | "straight";
  points: readonly PenPoint[];
}>;

export type PenDrawing = Readonly<{
  segments: readonly PenSegment[];
  width: number;
  height: number;
  fingerprint: string;
}>;

const GLYPHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  ",": ["00000", "00000", "00000", "00000", "00110", "00100", "01000"],
  ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
  ";": ["00000", "00110", "00110", "00000", "00110", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "=": ["00000", "11111", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "\\": ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
  "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
  "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
  ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "00000"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  "'": ["00100", "00100", "00000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
});

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const CHARACTER_ADVANCE = 6;
const LINE_ADVANCE = 9;

function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function drawableCharacter(character: string): string {
  const aliases: Readonly<Record<string, string>> = {
    "×": "X",
    "÷": "/",
    "−": "-",
    "–": "-",
    "—": "-",
    "≤": "<",
    "≥": ">",
    "≠": "#",
    "→": ">",
    "←": "<",
    "π": "P",
  };
  const normalized = aliases[character] ?? character.toUpperCase();
  return GLYPHS[normalized] ? normalized : "?";
}

function normalizeSegments(segments: readonly PenSegment[]): {
  segments: PenSegment[];
  width: number;
  height: number;
} {
  const points = segments.flatMap((segment) => segment.points);
  if (points.length === 0) throw new Error("A pen drawing must contain visible points.");
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    segments: segments.map((segment) => ({
      type: segment.type,
      points: segment.points.map((point) => ({
        x: Number((point.x - minX).toFixed(3)),
        y: Number((point.y - minY).toFixed(3)),
        ...(point.z === undefined ? {} : { z: point.z }),
      })),
    })),
    width: Math.max(1, Number((maxX - minX).toFixed(3))),
    height: Math.max(1, Number((maxY - minY).toFixed(3))),
  };
}

export function normalizePenDrawing(
  segments: readonly PenSegment[],
  fingerprintSource = JSON.stringify(segments),
): PenDrawing {
  const normalized = normalizeSegments(segments);
  return {
    ...normalized,
    fingerprint: stableFingerprint(`${PEN_RENDERER_VERSION}:${fingerprintSource}`),
  };
}

export function renderPenText(input: {
  text: string;
  fontSize: number;
  maxWidth: number;
}): PenDrawing {
  const scale = input.fontSize / GLYPH_HEIGHT;
  const maximumColumns = Math.max(
    1,
    Math.floor((input.maxWidth / scale + 1) / CHARACTER_ADVANCE),
  );
  const segments: PenSegment[] = [];
  let column = 0;
  let line = 0;

  for (const character of input.text) {
    if (character === "\r") continue;
    if (character === "\n") {
      column = 0;
      line += 1;
      continue;
    }
    if (column >= maximumColumns) {
      column = 0;
      line += 1;
    }
    if (character !== " ") {
      const glyph = GLYPHS[drawableCharacter(character)] ?? GLYPHS["?"]!;
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        const pixels = glyph[row]!;
        let start = -1;
        for (let pixel = 0; pixel <= GLYPH_WIDTH; pixel += 1) {
          const lit = pixel < GLYPH_WIDTH && pixels[pixel] === "1";
          if (lit && start === -1) start = pixel;
          if (!lit && start !== -1) {
            const y = (line * LINE_ADVANCE + row + 0.5) * scale;
            const x1 = (column * CHARACTER_ADVANCE + start) * scale;
            const x2 = (column * CHARACTER_ADVANCE + pixel - 0.2) * scale;
            segments.push({
              type: "straight",
              points: [
                { x: x1, y, z: 0.5 },
                { x: x2, y, z: 0.5 },
              ],
            });
            start = -1;
          }
        }
      }
    }
    column += 1;
  }

  if (segments.length === 0) {
    throw new Error("Pen text must contain at least one drawable character.");
  }
  return normalizePenDrawing(
    segments,
    JSON.stringify({
      text: input.text,
      fontSize: input.fontSize,
      maxWidth: input.maxWidth,
    }),
  );
}

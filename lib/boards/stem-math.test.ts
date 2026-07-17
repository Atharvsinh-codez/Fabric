import { describe, expect, it } from "vitest";

import {
  convertStemUnit,
  evaluateStemExpression,
  sampleStemGraph,
  STEM_GRAPH_LIMITS,
  STEM_UNIT_CATEGORIES,
  validateStemEquationCard,
} from "./stem-math";

describe("STEM expression engine", () => {
  it.each([
    ["2 + 3 * 4", 0, 14],
    ["-2^2", 0, -4],
    ["2x + 3", 4, 11],
    ["(x + 1)(x - 1)", 3, 8],
    ["2pi + 2e", 0, 2 * Math.PI + 2 * Math.E],
    ["sin(pi / 2) + cos(0)", 0, 2],
    ["sqrt(16) + abs(-3)", 0, 7],
    ["1e3 + x", 5, 1_005],
  ])("evaluates %s without dynamic code execution", (expression, x, expected) => {
    const result = evaluateStemExpression(expression, x);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value).toBeCloseTo(expected, 10);
  });

  it.each([
    "globalThis.process.exit()",
    "constructor.constructor('return 1')()",
    "unknown(x)",
    "sqrt(-1)",
    "1 / 0",
    "2 ** 4",
  ])("rejects unsupported or non-real expression %s", (expression) => {
    expect(evaluateStemExpression(expression, 1)).toMatchObject({ ok: false });
  });

  it("enforces expression, nesting, coordinate, and result bounds", () => {
    expect(
      evaluateStemExpression("x".repeat(STEM_GRAPH_LIMITS.expressionLength + 1), 0),
    ).toMatchObject({ ok: false });
    expect(evaluateStemExpression("(".repeat(40) + "1" + ")".repeat(40), 0)).toMatchObject({
      ok: false,
    });
    expect(evaluateStemExpression("x", Number.POSITIVE_INFINITY)).toMatchObject({ ok: false });
    expect(evaluateStemExpression("10^1000", 0)).toMatchObject({ ok: false });
  });
});

describe("STEM graph sampling", () => {
  it("samples a bounded deterministic parabola into visible segments", () => {
    const first = sampleStemGraph({
      expression: "x^2 - 4",
      xMin: -4,
      xMax: 4,
      yMin: -5,
      yMax: 12,
      sampleCount: 81,
    });
    const second = sampleStemGraph({
      expression: "x^2 - 4",
      xMin: -4,
      xMax: 4,
      yMin: -5,
      yMax: 12,
      sampleCount: 81,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, expression: "x^2 - 4", sampleCount: 81 });
    if (!first.ok) throw new Error(first.message);
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0]?.length).toBeGreaterThan(60);
    expect(first.segments.flat().every(({ x, y }) => x >= -4 && x <= 4 && y >= -5 && y <= 12))
      .toBe(true);
  });

  it("splits discontinuities instead of drawing across an asymptote", () => {
    const result = sampleStemGraph({
      expression: "1 / x",
      xMin: -5,
      xMax: 5,
      yMin: -10,
      yMax: 10,
      sampleCount: 101,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.segments.length).toBeGreaterThanOrEqual(2);
    result.segments.forEach((segment) => {
      expect(segment.every(({ x }) => x < 0) || segment.every(({ x }) => x > 0)).toBe(true);
    });
  });

  it("rejects unsafe windows, sample counts, and invisible functions", () => {
    expect(sampleStemGraph({ expression: "x", xMin: 10, xMax: -10 })).toMatchObject({ ok: false });
    expect(sampleStemGraph({ expression: "x", sampleCount: 10 })).toMatchObject({ ok: false });
    expect(sampleStemGraph({ expression: "x + 1000", yMin: -10, yMax: 10 })).toMatchObject({
      ok: false,
    });
  });
});

describe("STEM unit converter", () => {
  it("publishes complete category and unit labels for the UI", () => {
    expect(STEM_UNIT_CATEGORIES.map(({ id }) => id)).toEqual([
      "length",
      "mass",
      "temperature",
      "time",
      "area",
      "volume",
      "data",
    ]);
    expect(STEM_UNIT_CATEGORIES.every((category) => category.units.length >= 3)).toBe(true);
    expect(STEM_UNIT_CATEGORIES.flatMap(({ units }) => units).every(({ name, symbol }) => name && symbol))
      .toBe(true);
  });

  it.each([
    [{ category: "length" as const, value: 1, from: "mi" as const, to: "km" as const }, 1.609344],
    [{ category: "mass" as const, value: 1, from: "kg" as const, to: "g" as const }, 1_000],
    [{ category: "time" as const, value: 2, from: "day" as const, to: "h" as const }, 48],
    [{ category: "data" as const, value: 1, from: "gib" as const, to: "mib" as const }, 1_024],
  ])("converts $0.category units through their stable base", (request, expected) => {
    const result = convertStemUnit(request);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.convertedValue).toBeCloseTo(expected, 10);
  });

  it("converts temperatures and protects absolute zero", () => {
    const freezing = convertStemUnit({ category: "temperature", value: 32, from: "f", to: "c" });
    expect(freezing).toMatchObject({ ok: true, display: "0" });
    const absoluteZero = convertStemUnit({
      category: "temperature",
      value: -274,
      from: "c",
      to: "k",
    });
    expect(absoluteZero).toMatchObject({ ok: false });
  });

  it("rejects cross-category and non-finite conversion input", () => {
    expect(
      convertStemUnit({ category: "length", value: 1, from: "kg", to: "m" }),
    ).toMatchObject({ ok: false });
    expect(
      convertStemUnit({ category: "length", value: Number.NaN, from: "m", to: "km" }),
    ).toMatchObject({ ok: false });
  });
});

describe("equation cards", () => {
  it("normalizes bounded editable card content", () => {
    expect(
      validateStemEquationCard({
        title: "  Kinetic   Energy ",
        equation: " Eₖ = ½mv² ",
        note: "  m is mass\n and v is velocity. ",
      }),
    ).toEqual({
      ok: true,
      card: {
        title: "Kinetic Energy",
        equation: "Eₖ = ½mv²",
        note: "m is mass and v is velocity.",
      },
    });
  });

  it("rejects empty, oversized, and forged non-text content", () => {
    expect(validateStemEquationCard({ equation: "" })).toMatchObject({ ok: false });
    expect(validateStemEquationCard({ equation: "x".repeat(121) })).toMatchObject({ ok: false });
    expect(validateStemEquationCard({ equation: 42 as unknown as string })).toMatchObject({
      ok: false,
    });
  });
});

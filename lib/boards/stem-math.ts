export const STEM_GRAPH_LIMITS = {
  expressionLength: 160,
  minSamples: 41,
  maxSamples: 201,
  maxAxisMagnitude: 1_000_000,
  maxAxisSpan: 1_000_000,
} as const;

const MAX_TOKENS = 256;
const MAX_PARSE_DEPTH = 32;
const MAX_EVALUATION_STEPS = 1_024;
const MAX_VALUE_MAGNITUDE = 1e18;
const MIN_AXIS_SPAN = 1e-6;

type BinaryOperator = "+" | "-" | "*" | "/" | "^";
type UnaryOperator = "+" | "-";

type Token =
  | Readonly<{ type: "number"; value: number }>
  | Readonly<{ type: "identifier"; value: string }>
  | Readonly<{ type: "operator"; value: BinaryOperator }>
  | Readonly<{ type: "left-parenthesis" | "right-parenthesis" | "end" }>;

type ExpressionNode =
  | Readonly<{ type: "number"; value: number }>
  | Readonly<{ type: "variable" }>
  | Readonly<{ type: "unary"; operator: UnaryOperator; value: ExpressionNode }>
  | Readonly<{
      type: "binary";
      operator: BinaryOperator;
      left: ExpressionNode;
      right: ExpressionNode;
    }>
  | Readonly<{ type: "function"; name: StemFunctionName; argument: ExpressionNode }>;

const STEM_FUNCTIONS = [
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sqrt",
  "abs",
  "ln",
  "log",
  "exp",
  "round",
  "floor",
  "ceil",
] as const;

type StemFunctionName = (typeof STEM_FUNCTIONS)[number];

class StemMathError extends Error {}

function isStemFunction(value: string): value is StemFunctionName {
  return (STEM_FUNCTIONS as readonly string[]).includes(value);
}

function normalizeExpression(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .replaceAll("−", "-")
    .replaceAll("π", "pi")
    .replaceAll(/\s+/g, "");
}

function tokenize(input: string): readonly Token[] {
  const raw: Token[] = [];
  let offset = 0;

  while (offset < input.length) {
    const character = input[offset] ?? "";
    if (/[0-9.]/.test(character)) {
      const start = offset;
      let decimalPoints = 0;
      while (offset < input.length && /[0-9.]/.test(input[offset] ?? "")) {
        if (input[offset] === ".") decimalPoints += 1;
        offset += 1;
      }
      if (decimalPoints > 1) throw new StemMathError("Check the number formatting.");
      if (input[offset] === "e") {
        let exponentOffset = offset + 1;
        if (["+", "-"].includes(input[exponentOffset] ?? "")) exponentOffset += 1;
        if (/[0-9]/.test(input[exponentOffset] ?? "")) {
          offset = exponentOffset + 1;
          while (/[0-9]/.test(input[offset] ?? "")) offset += 1;
        }
      }
      const source = input.slice(start, offset);
      const value = Number(source);
      if (!source || source === "." || !Number.isFinite(value)) {
        throw new StemMathError("Check the number formatting.");
      }
      raw.push({ type: "number", value });
      continue;
    }

    if (/[a-z]/.test(character)) {
      const start = offset;
      while (/[a-z]/.test(input[offset] ?? "")) offset += 1;
      raw.push({ type: "identifier", value: input.slice(start, offset) });
      continue;
    }

    if (character === "(") raw.push({ type: "left-parenthesis" });
    else if (character === ")") raw.push({ type: "right-parenthesis" });
    else if (["+", "-", "*", "/", "^"].includes(character)) {
      raw.push({ type: "operator", value: character as BinaryOperator });
    } else {
      throw new StemMathError(
        "Use x, numbers, parentheses, and supported mathematical functions.",
      );
    }
    offset += 1;
  }

  const tokens: Token[] = [];
  for (const token of raw) {
    const previous = tokens.at(-1);
    const previousEndsValue =
      previous?.type === "number" ||
      previous?.type === "right-parenthesis" ||
      (previous?.type === "identifier" && !isStemFunction(previous.value));
    const tokenStartsValue =
      token.type === "number" || token.type === "identifier" || token.type === "left-parenthesis";
    const isFunctionCall =
      previous?.type === "identifier" &&
      isStemFunction(previous.value) &&
      token.type === "left-parenthesis";
    if (previousEndsValue && tokenStartsValue && !isFunctionCall) {
      tokens.push({ type: "operator", value: "*" });
    }
    tokens.push(token);
  }

  if (tokens.length > MAX_TOKENS) {
    throw new StemMathError("The expression is too complex. Shorten it and try again.");
  }
  tokens.push({ type: "end" });
  return tokens;
}

class StemExpressionParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): ExpressionNode {
    const expression = this.parseSum(0);
    if (this.current().type !== "end") {
      throw new StemMathError("Check the expression and try again.");
    }
    return expression;
  }

  private current(): Token {
    return this.tokens[this.index] ?? { type: "end" };
  }

  private advance(): Token {
    const current = this.current();
    this.index += 1;
    return current;
  }

  private guardDepth(depth: number): void {
    if (depth > MAX_PARSE_DEPTH) {
      throw new StemMathError("The expression is too deeply nested.");
    }
  }

  private takeOperator(operator: BinaryOperator): boolean {
    const token = this.current();
    if (token.type !== "operator" || token.value !== operator) return false;
    this.advance();
    return true;
  }

  private parseSum(depth: number): ExpressionNode {
    this.guardDepth(depth);
    let value = this.parseProduct(depth);
    while (true) {
      if (this.takeOperator("+")) {
        value = { type: "binary", operator: "+", left: value, right: this.parseProduct(depth) };
      } else if (this.takeOperator("-")) {
        value = { type: "binary", operator: "-", left: value, right: this.parseProduct(depth) };
      } else {
        return value;
      }
    }
  }

  private parseProduct(depth: number): ExpressionNode {
    let value = this.parseUnary(depth);
    while (true) {
      if (this.takeOperator("*")) {
        value = { type: "binary", operator: "*", left: value, right: this.parseUnary(depth) };
      } else if (this.takeOperator("/")) {
        value = { type: "binary", operator: "/", left: value, right: this.parseUnary(depth) };
      } else {
        return value;
      }
    }
  }

  private parseUnary(depth: number): ExpressionNode {
    this.guardDepth(depth);
    if (this.takeOperator("+")) {
      return { type: "unary", operator: "+", value: this.parseUnary(depth + 1) };
    }
    if (this.takeOperator("-")) {
      return { type: "unary", operator: "-", value: this.parseUnary(depth + 1) };
    }
    return this.parsePower(depth);
  }

  private parsePower(depth: number): ExpressionNode {
    const value = this.parsePrimary(depth);
    if (!this.takeOperator("^")) return value;
    return {
      type: "binary",
      operator: "^",
      left: value,
      right: this.parseUnary(depth + 1),
    };
  }

  private parsePrimary(depth: number): ExpressionNode {
    this.guardDepth(depth);
    const token = this.current();
    if (token.type === "number") {
      this.advance();
      return { type: "number", value: token.value };
    }
    if (token.type === "identifier") {
      this.advance();
      if (token.value === "x") return { type: "variable" };
      if (token.value === "pi") return { type: "number", value: Math.PI };
      if (token.value === "e") return { type: "number", value: Math.E };
      if (!isStemFunction(token.value)) {
        throw new StemMathError(`Unknown symbol “${token.value}”. Use x for the variable.`);
      }
      if (this.current().type !== "left-parenthesis") {
        throw new StemMathError(`Use ${token.value} with parentheses.`);
      }
      this.advance();
      const argument = this.parseSum(depth + 1);
      if (this.current().type !== "right-parenthesis") {
        throw new StemMathError("Close every open parenthesis.");
      }
      this.advance();
      return { type: "function", name: token.value, argument };
    }
    if (token.type === "left-parenthesis") {
      this.advance();
      const value = this.parseSum(depth + 1);
      if (this.current().type !== "right-parenthesis") {
        throw new StemMathError("Close every open parenthesis.");
      }
      this.advance();
      return value;
    }
    throw new StemMathError("Finish the expression before graphing it.");
  }
}

function ensureValue(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_VALUE_MAGNITUDE) {
    throw new StemMathError("The result is outside the supported range.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function evaluateNode(node: ExpressionNode, x: number, budget: { remaining: number }): number {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw new StemMathError("The expression is too complex.");

  switch (node.type) {
    case "number":
      return node.value;
    case "variable":
      return x;
    case "unary": {
      const value = evaluateNode(node.value, x, budget);
      return ensureValue(node.operator === "-" ? -value : value);
    }
    case "binary": {
      const left = evaluateNode(node.left, x, budget);
      const right = evaluateNode(node.right, x, budget);
      switch (node.operator) {
        case "+":
          return ensureValue(left + right);
        case "-":
          return ensureValue(left - right);
        case "*":
          return ensureValue(left * right);
        case "/":
          if (right === 0) throw new StemMathError("Division by zero is undefined.");
          return ensureValue(left / right);
        case "^":
          if (Math.abs(right) > 1_000) throw new StemMathError("The exponent is too large.");
          if (left === 0 && right === 0) throw new StemMathError("Zero to the zero power is undefined.");
          return ensureValue(Math.pow(left, right));
      }
    }
    case "function": {
      const value = evaluateNode(node.argument, x, budget);
      let result: number;
      switch (node.name) {
        case "sin":
          result = Math.sin(value);
          break;
        case "cos":
          result = Math.cos(value);
          break;
        case "tan":
          result = Math.tan(value);
          break;
        case "asin":
          result = Math.asin(value);
          break;
        case "acos":
          result = Math.acos(value);
          break;
        case "atan":
          result = Math.atan(value);
          break;
        case "sqrt":
          result = Math.sqrt(value);
          break;
        case "abs":
          result = Math.abs(value);
          break;
        case "ln":
          result = Math.log(value);
          break;
        case "log":
          result = Math.log10(value);
          break;
        case "exp":
          result = Math.exp(value);
          break;
        case "round":
          result = Math.round(value);
          break;
        case "floor":
          result = Math.floor(value);
          break;
        case "ceil":
          result = Math.ceil(value);
          break;
      }
      return ensureValue(result);
    }
  }
}

function parseExpression(input: string): ExpressionNode {
  const expression = normalizeExpression(input);
  if (!expression) throw new StemMathError("Enter an expression to graph.");
  if (expression.length > STEM_GRAPH_LIMITS.expressionLength) {
    throw new StemMathError(
      `Keep the expression under ${STEM_GRAPH_LIMITS.expressionLength} characters.`,
    );
  }
  return new StemExpressionParser(tokenize(expression)).parse();
}

export type StemExpressionResult =
  | Readonly<{ ok: true; expression: string; value: number; display: string }>
  | Readonly<{ ok: false; message: string }>;

export function formatStemNumber(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : Number(value.toPrecision(10));
  const magnitude = Math.abs(normalized);
  if (magnitude >= 1e10 || (magnitude > 0 && magnitude < 1e-7)) {
    return normalized
      .toExponential(6)
      .replace(/\.0+e/, "e")
      .replace(/(\.\d*?[1-9])0+e/, "$1e")
      .replace("e+", "e");
  }
  return String(normalized);
}

export function evaluateStemExpression(input: string, x: number): StemExpressionResult {
  if (!Number.isFinite(x) || Math.abs(x) > STEM_GRAPH_LIMITS.maxAxisMagnitude) {
    return { ok: false, message: "x is outside the supported range." };
  }
  try {
    const node = parseExpression(input);
    const value = evaluateNode(node, x, { remaining: MAX_EVALUATION_STEPS });
    return {
      ok: true,
      expression: input.trim(),
      value,
      display: formatStemNumber(value),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof StemMathError ? error.message : "The expression could not be evaluated.",
    };
  }
}

export type StemGraphRequest = Readonly<{
  expression: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  sampleCount?: number;
}>;

export type StemGraphPoint = Readonly<{ x: number; y: number }>;

export type StemGraphResult =
  | Readonly<{
      ok: true;
      expression: string;
      xMin: number;
      xMax: number;
      yMin: number;
      yMax: number;
      sampleCount: number;
      segments: readonly (readonly StemGraphPoint[])[];
    }>
  | Readonly<{ ok: false; message: string }>;

function validateAxisRange(minimum: number, maximum: number, name: string): void {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new StemMathError(`${name} bounds must be finite numbers.`);
  }
  if (minimum >= maximum) throw new StemMathError(`${name} minimum must be below its maximum.`);
  if (
    Math.abs(minimum) > STEM_GRAPH_LIMITS.maxAxisMagnitude ||
    Math.abs(maximum) > STEM_GRAPH_LIMITS.maxAxisMagnitude ||
    maximum - minimum > STEM_GRAPH_LIMITS.maxAxisSpan
  ) {
    throw new StemMathError(`${name} range is too large.`);
  }
  if (maximum - minimum < MIN_AXIS_SPAN) {
    throw new StemMathError(`${name} range is too narrow.`);
  }
}

function tryEvaluate(node: ExpressionNode, x: number): number | null {
  try {
    return evaluateNode(node, x, { remaining: MAX_EVALUATION_STEPS });
  } catch {
    return null;
  }
}

export function sampleStemGraph(request: StemGraphRequest): StemGraphResult {
  try {
    const expression = request.expression.trim();
    const node = parseExpression(expression);
    const xMin = request.xMin ?? -10;
    const xMax = request.xMax ?? 10;
    const yMin = request.yMin ?? -10;
    const yMax = request.yMax ?? 10;
    const sampleCount = request.sampleCount ?? 121;
    validateAxisRange(xMin, xMax, "x");
    validateAxisRange(yMin, yMax, "y");
    if (
      !Number.isInteger(sampleCount) ||
      sampleCount < STEM_GRAPH_LIMITS.minSamples ||
      sampleCount > STEM_GRAPH_LIMITS.maxSamples
    ) {
      throw new StemMathError(
        `Use ${STEM_GRAPH_LIMITS.minSamples}–${STEM_GRAPH_LIMITS.maxSamples} graph samples.`,
      );
    }

    const ySpan = yMax - yMin;
    const step = (xMax - xMin) / (sampleCount - 1);
    const segments: StemGraphPoint[][] = [];
    let current: StemGraphPoint[] = [];
    let previous: StemGraphPoint | null = null;

    const finishSegment = () => {
      if (current.length >= 2) segments.push(current);
      current = [];
      previous = null;
    };

    for (let index = 0; index < sampleCount; index += 1) {
      const x = index === sampleCount - 1 ? xMax : xMin + step * index;
      const y = tryEvaluate(node, x);
      if (y === null || y < yMin || y > yMax) {
        finishSegment();
        continue;
      }

      const point = { x, y };
      if (previous) {
        const midpointX = (previous.x + x) / 2;
        const midpointY = tryEvaluate(node, midpointX);
        const midpointDeviation =
          midpointY === null ? Number.POSITIVE_INFINITY : Math.abs(midpointY - (previous.y + y) / 2);
        if (Math.abs(y - previous.y) > ySpan * 0.7 || midpointDeviation > ySpan * 0.65) {
          finishSegment();
        }
      }
      current.push(point);
      previous = point;
    }
    finishSegment();

    if (segments.length === 0) {
      throw new StemMathError("The function does not cross the current graph window.");
    }

    return { ok: true, expression, xMin, xMax, yMin, yMax, sampleCount, segments };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof StemMathError ? error.message : "The graph could not be created.",
    };
  }
}

export const STEM_UNIT_CATEGORY_IDS = [
  "length",
  "mass",
  "temperature",
  "time",
  "area",
  "volume",
  "data",
] as const;

export type StemUnitCategoryId = (typeof STEM_UNIT_CATEGORY_IDS)[number];

export type StemUnitId =
  | "m"
  | "km"
  | "cm"
  | "mm"
  | "mi"
  | "yd"
  | "ft"
  | "in"
  | "kg"
  | "g"
  | "mg"
  | "lb"
  | "oz"
  | "c"
  | "f"
  | "k"
  | "s"
  | "min"
  | "h"
  | "day"
  | "week"
  | "m2"
  | "km2"
  | "cm2"
  | "ft2"
  | "in2"
  | "acre"
  | "hectare"
  | "l"
  | "ml"
  | "m3"
  | "gal-us"
  | "qt-us"
  | "cup-us"
  | "bit"
  | "byte"
  | "kb"
  | "mb"
  | "gb"
  | "kib"
  | "mib"
  | "gib";

export type StemUnitDefinition = Readonly<{
  id: StemUnitId;
  name: string;
  symbol: string;
  category: StemUnitCategoryId;
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
}>;

export type StemUnitCategory = Readonly<{
  id: StemUnitCategoryId;
  name: string;
  units: readonly StemUnitDefinition[];
}>;

function linearUnit(
  category: StemUnitCategoryId,
  id: StemUnitId,
  name: string,
  symbol: string,
  factor: number,
): StemUnitDefinition {
  return {
    id,
    name,
    symbol,
    category,
    toBase: (value) => value * factor,
    fromBase: (value) => value / factor,
  };
}

const temperatureUnits: readonly StemUnitDefinition[] = [
  {
    id: "c",
    name: "Celsius",
    symbol: "°C",
    category: "temperature",
    toBase: (value) => value + 273.15,
    fromBase: (value) => value - 273.15,
  },
  {
    id: "f",
    name: "Fahrenheit",
    symbol: "°F",
    category: "temperature",
    toBase: (value) => ((value - 32) * 5) / 9 + 273.15,
    fromBase: (value) => ((value - 273.15) * 9) / 5 + 32,
  },
  linearUnit("temperature", "k", "Kelvin", "K", 1),
];

export const STEM_UNIT_CATEGORIES: readonly StemUnitCategory[] = [
  {
    id: "length",
    name: "Length",
    units: [
      linearUnit("length", "m", "Metres", "m", 1),
      linearUnit("length", "km", "Kilometres", "km", 1_000),
      linearUnit("length", "cm", "Centimetres", "cm", 0.01),
      linearUnit("length", "mm", "Millimetres", "mm", 0.001),
      linearUnit("length", "mi", "Miles", "mi", 1_609.344),
      linearUnit("length", "yd", "Yards", "yd", 0.9144),
      linearUnit("length", "ft", "Feet", "ft", 0.3048),
      linearUnit("length", "in", "Inches", "in", 0.0254),
    ],
  },
  {
    id: "mass",
    name: "Mass",
    units: [
      linearUnit("mass", "kg", "Kilograms", "kg", 1),
      linearUnit("mass", "g", "Grams", "g", 0.001),
      linearUnit("mass", "mg", "Milligrams", "mg", 0.000_001),
      linearUnit("mass", "lb", "Pounds", "lb", 0.453_592_37),
      linearUnit("mass", "oz", "Ounces", "oz", 0.028_349_523_125),
    ],
  },
  { id: "temperature", name: "Temperature", units: temperatureUnits },
  {
    id: "time",
    name: "Time",
    units: [
      linearUnit("time", "s", "Seconds", "s", 1),
      linearUnit("time", "min", "Minutes", "min", 60),
      linearUnit("time", "h", "Hours", "h", 3_600),
      linearUnit("time", "day", "Days", "days", 86_400),
      linearUnit("time", "week", "Weeks", "weeks", 604_800),
    ],
  },
  {
    id: "area",
    name: "Area",
    units: [
      linearUnit("area", "m2", "Square metres", "m²", 1),
      linearUnit("area", "km2", "Square kilometres", "km²", 1_000_000),
      linearUnit("area", "cm2", "Square centimetres", "cm²", 0.0001),
      linearUnit("area", "ft2", "Square feet", "ft²", 0.092_903_04),
      linearUnit("area", "in2", "Square inches", "in²", 0.000_645_16),
      linearUnit("area", "acre", "Acres", "ac", 4_046.856_422_4),
      linearUnit("area", "hectare", "Hectares", "ha", 10_000),
    ],
  },
  {
    id: "volume",
    name: "Volume",
    units: [
      linearUnit("volume", "l", "Litres", "L", 1),
      linearUnit("volume", "ml", "Millilitres", "mL", 0.001),
      linearUnit("volume", "m3", "Cubic metres", "m³", 1_000),
      linearUnit("volume", "gal-us", "US gallons", "US gal", 3.785_411_784),
      linearUnit("volume", "qt-us", "US quarts", "US qt", 0.946_352_946),
      linearUnit("volume", "cup-us", "US cups", "US cup", 0.236_588_236_5),
    ],
  },
  {
    id: "data",
    name: "Data",
    units: [
      linearUnit("data", "bit", "Bits", "bit", 0.125),
      linearUnit("data", "byte", "Bytes", "B", 1),
      linearUnit("data", "kb", "Kilobytes", "kB", 1_000),
      linearUnit("data", "mb", "Megabytes", "MB", 1_000_000),
      linearUnit("data", "gb", "Gigabytes", "GB", 1_000_000_000),
      linearUnit("data", "kib", "Kibibytes", "KiB", 1_024),
      linearUnit("data", "mib", "Mebibytes", "MiB", 1_048_576),
      linearUnit("data", "gib", "Gibibytes", "GiB", 1_073_741_824),
    ],
  },
] as const;

export type StemConversionRequest = Readonly<{
  category: StemUnitCategoryId;
  value: number;
  from: StemUnitId;
  to: StemUnitId;
}>;

export type StemConversionResult =
  | Readonly<{
      ok: true;
      category: StemUnitCategoryId;
      value: number;
      convertedValue: number;
      display: string;
      from: StemUnitDefinition;
      to: StemUnitDefinition;
    }>
  | Readonly<{ ok: false; message: string }>;

export function convertStemUnit(request: StemConversionRequest): StemConversionResult {
  if (!Number.isFinite(request.value) || Math.abs(request.value) > 1e15) {
    return { ok: false, message: "Enter a finite value within the supported range." };
  }
  const category = STEM_UNIT_CATEGORIES.find((candidate) => candidate.id === request.category);
  const from = category?.units.find((unit) => unit.id === request.from);
  const to = category?.units.find((unit) => unit.id === request.to);
  if (!category || !from || !to) {
    return { ok: false, message: "Choose two units from the same category." };
  }
  const baseValue = from.toBase(request.value);
  if (category.id === "temperature" && baseValue < -1e-9) {
    return { ok: false, message: "Temperature cannot be below absolute zero." };
  }
  const convertedValue = to.fromBase(baseValue);
  if (!Number.isFinite(convertedValue) || Math.abs(convertedValue) > MAX_VALUE_MAGNITUDE) {
    return { ok: false, message: "The converted value is outside the supported range." };
  }
  return {
    ok: true,
    category: category.id,
    value: request.value,
    convertedValue: Object.is(convertedValue, -0) ? 0 : convertedValue,
    display: formatStemNumber(convertedValue),
    from,
    to,
  };
}

export type StemEquationCardInput = Readonly<{
  title?: string;
  equation: string;
  note?: string;
}>;

export type ValidatedStemEquationCard = Readonly<{
  title: string;
  equation: string;
  note: string;
}>;

export type StemEquationValidationResult =
  | Readonly<{ ok: true; card: ValidatedStemEquationCard }>
  | Readonly<{ ok: false; message: string }>;

function normalizeCardText(value: string): string {
  return value.replaceAll(/[\r\n\t ]+/g, " ").trim();
}

export function validateStemEquationCard(
  input: StemEquationCardInput,
): StemEquationValidationResult {
  if (
    typeof input.equation !== "string" ||
    (input.title !== undefined && typeof input.title !== "string") ||
    (input.note !== undefined && typeof input.note !== "string")
  ) {
    return { ok: false, message: "Use text for the equation card fields." };
  }
  const title = normalizeCardText(input.title ?? "Equation");
  const equation = normalizeCardText(input.equation);
  const note = normalizeCardText(input.note ?? "Add the derivation, variables, and units here.");
  if (!title || title.length > 48) {
    return { ok: false, message: "Keep the equation title between 1 and 48 characters." };
  }
  if (!equation || equation.length > 120) {
    return { ok: false, message: "Keep the equation between 1 and 120 characters." };
  }
  if (!note || note.length > 280) {
    return { ok: false, message: "Keep the equation note between 1 and 280 characters." };
  }
  if (/\p{Cc}/u.test(`${title}${equation}${note}`)) {
    return { ok: false, message: "Remove unsupported control characters." };
  }
  return { ok: true, card: { title, equation, note } };
}

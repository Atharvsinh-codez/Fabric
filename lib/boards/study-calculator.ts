const MAX_EXPRESSION_LENGTH = 160;
const MAX_TOKENS = 256;
const MAX_PARSE_DEPTH = 48;
const MAX_RESULT_MAGNITUDE = 1e100;

type OperatorToken = "+" | "-" | "*" | "/" | "^" | "%";

type Token =
  | Readonly<{ type: "number"; value: number }>
  | Readonly<{ type: "identifier"; value: string }>
  | Readonly<{ type: "operator"; value: OperatorToken }>
  | Readonly<{ type: "left-parenthesis" }>
  | Readonly<{ type: "right-parenthesis" }>
  | Readonly<{ type: "end" }>;

export type StudyCalculationResult =
  | Readonly<{
      ok: true;
      expression: string;
      value: number;
      display: string;
    }>
  | Readonly<{
      ok: false;
      message: string;
    }>;

class CalculationError extends Error {}

function normalizeExpression(input: string): string {
  return input
    .trim()
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .replaceAll("−", "-")
    .replaceAll("π", "pi");
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;

  while (offset < expression.length) {
    const remaining = expression.slice(offset);
    const whitespace = remaining.match(/^\s+/);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }

    const number = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) {
        throw new CalculationError("This number is too large. Use a smaller value.");
      }
      tokens.push({ type: "number", value });
      offset += number[0].length;
    } else {
      const identifier = remaining.match(/^[a-z]+/i);
      if (identifier) {
        tokens.push({ type: "identifier", value: identifier[0].toLowerCase() });
        offset += identifier[0].length;
      } else {
        const character = remaining[0];
        if (character === "(") tokens.push({ type: "left-parenthesis" });
        else if (character === ")") tokens.push({ type: "right-parenthesis" });
        else if (["+", "-", "*", "/", "^", "%"].includes(character)) {
          tokens.push({ type: "operator", value: character as OperatorToken });
        } else {
          throw new CalculationError(
            "Use numbers, parentheses, and the supported calculator keys.",
          );
        }
        offset += 1;
      }
    }

    if (tokens.length > MAX_TOKENS) {
      throw new CalculationError("Calculation is too complex. Shorten the expression.");
    }
  }

  tokens.push({ type: "end" });
  return tokens;
}

class ExpressionParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number {
    const value = this.parseExpression(0);
    if (this.current().type !== "end") {
      throw new CalculationError("Check the expression and try again.");
    }
    return this.ensureFinite(value);
  }

  private current(): Token {
    return this.tokens[this.index] ?? { type: "end" };
  }

  private advance(): Token {
    const token = this.current();
    this.index += 1;
    return token;
  }

  private matchesOperator(operator: OperatorToken): boolean {
    const token = this.current();
    if (token.type !== "operator" || token.value !== operator) return false;
    this.advance();
    return true;
  }

  private guardDepth(depth: number): void {
    if (depth > MAX_PARSE_DEPTH) {
      throw new CalculationError("Calculation is too deeply nested. Remove a few parentheses.");
    }
  }

  private parseExpression(depth: number): number {
    this.guardDepth(depth);
    let value = this.parseTerm(depth);
    while (true) {
      if (this.matchesOperator("+")) value += this.parseTerm(depth);
      else if (this.matchesOperator("-")) value -= this.parseTerm(depth);
      else break;
      value = this.ensureFinite(value);
    }
    return value;
  }

  private parseTerm(depth: number): number {
    let value = this.parseUnary(depth);
    while (true) {
      if (this.matchesOperator("*")) {
        value *= this.parseUnary(depth);
      } else if (this.matchesOperator("/")) {
        const divisor = this.parseUnary(depth);
        if (divisor === 0) throw new CalculationError("Cannot divide by zero.");
        value /= divisor;
      } else {
        break;
      }
      value = this.ensureFinite(value);
    }
    return value;
  }

  private parseUnary(depth: number): number {
    this.guardDepth(depth);
    if (this.matchesOperator("+")) return this.parseUnary(depth + 1);
    if (this.matchesOperator("-")) return -this.parseUnary(depth + 1);
    return this.parsePower(depth);
  }

  private parsePower(depth: number): number {
    let value = this.parsePostfix(depth);
    if (this.matchesOperator("^")) {
      const exponent = this.parseUnary(depth + 1);
      if (Math.abs(exponent) > 1_000) {
        throw new CalculationError("Power is too large. Keep the exponent between -1000 and 1000.");
      }
      if (value === 0 && exponent === 0) {
        throw new CalculationError("Zero to the power of zero is undefined.");
      }
      value = Math.pow(value, exponent);
    }
    return this.ensureFinite(value);
  }

  private parsePostfix(depth: number): number {
    let value = this.parsePrimary(depth);
    while (this.matchesOperator("%")) value /= 100;
    return value;
  }

  private parsePrimary(depth: number): number {
    this.guardDepth(depth);
    const token = this.current();
    if (token.type === "number") {
      this.advance();
      return token.value;
    }

    if (token.type === "identifier") {
      this.advance();
      if (token.value === "pi") return Math.PI;
      if (token.value === "e") return Math.E;
      if (this.current().type !== "left-parenthesis") {
        throw new CalculationError(`Use ${token.value} with parentheses.`);
      }
      this.advance();
      const argument = this.parseExpression(depth + 1);
      if (this.current().type !== "right-parenthesis") {
        throw new CalculationError("Close every open parenthesis.");
      }
      this.advance();
      return this.applyFunction(token.value, argument);
    }

    if (token.type === "left-parenthesis") {
      this.advance();
      const value = this.parseExpression(depth + 1);
      if (this.current().type !== "right-parenthesis") {
        throw new CalculationError("Close every open parenthesis.");
      }
      this.advance();
      return value;
    }

    throw new CalculationError("Finish the calculation before adding it.");
  }

  private applyFunction(name: string, value: number): number {
    let result: number;
    switch (name) {
      case "sqrt":
        if (value < 0) {
          throw new CalculationError("Square root needs a value of zero or more.");
        }
        result = Math.sqrt(value);
        break;
      case "abs":
        result = Math.abs(value);
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
      case "ln":
        if (value <= 0) throw new CalculationError("Natural log needs a value above zero.");
        result = Math.log(value);
        break;
      case "log":
        if (value <= 0) throw new CalculationError("Log needs a value above zero.");
        result = Math.log10(value);
        break;
      default:
        throw new CalculationError(`Function ${name} is not supported.`);
    }
    return this.ensureFinite(result);
  }

  private ensureFinite(value: number): number {
    if (Number.isNaN(value)) {
      throw new CalculationError("This calculation has no real-number result.");
    }
    if (!Number.isFinite(value) || Math.abs(value) > MAX_RESULT_MAGNITUDE) {
      throw new CalculationError("This result is too large. Use smaller values.");
    }
    return value;
  }
}

function formatResult(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : Number(value.toPrecision(12));
  const magnitude = Math.abs(normalized);
  if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-9)) {
    return normalized
      .toExponential(8)
      .replace(/\.0+e/, "e")
      .replace(/(\.\d*?[1-9])0+e/, "$1e")
      .replace("e+", "e");
  }
  return String(normalized);
}

export function calculateStudyExpression(input: string): StudyCalculationResult {
  const expression = input.trim();
  if (!expression) return { ok: false, message: "Enter a calculation." };
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return {
      ok: false,
      message: `Calculation is too long. Keep it under ${MAX_EXPRESSION_LENGTH} characters.`,
    };
  }

  try {
    const normalized = normalizeExpression(expression);
    const value = new ExpressionParser(tokenize(normalized)).parse();
    return { ok: true, expression, value, display: formatResult(value) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof CalculationError
        ? error.message
        : "The calculation could not be completed. Check the expression.",
    };
  }
}

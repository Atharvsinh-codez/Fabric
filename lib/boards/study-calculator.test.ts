import { describe, expect, it } from "vitest";

import { calculateStudyExpression } from "./study-calculator";

function expectCalculation(
  expression: string,
  expected: number,
): Extract<ReturnType<typeof calculateStudyExpression>, { ok: true }> {
  const result = calculateStudyExpression(expression);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.message);
  expect(result.value).toBeCloseTo(expected, 10);
  return result;
}

function expectCalculationError(expression: string, message: string | RegExp): void {
  const result = calculateStudyExpression(expression);
  expect(result).toMatchObject({ ok: false });
  if (result.ok) throw new Error(`Expected ${expression} to be rejected`);
  if (typeof message === "string") expect(result.message).toBe(message);
  else expect(result.message).toMatch(message);
}

describe("study calculator", () => {
  it("applies arithmetic precedence, parentheses, unary signs, and right-associative powers", () => {
    expectCalculation("2 + 3 * 4", 14);
    expectCalculation("(2 + 3) * 4", 20);
    expectCalculation("2^3^2", 512);
    expectCalculation("-2^2", -4);
    expectCalculation("2^-3", 0.125);
  });

  it("accepts the calculator's unicode operators and pi key without changing the saved expression", () => {
    const multiplication = expectCalculation(" 2 \u00d7 3 ", 6);
    expect(multiplication.expression).toBe("2 \u00d7 3");
    expect(multiplication.display).toBe("6");

    expectCalculation("18 \u00f7 3", 6);
    expectCalculation("10 \u2212 3", 7);
    expectCalculation("2 \u00d7 \u03c0", 2 * Math.PI);
  });

  it("treats percent as a bounded postfix operator", () => {
    expectCalculation("50%", 0.5);
    expectCalculation("200 * 15%", 30);
    expectCalculation("50%%", 0.005);
  });

  it("supports the documented constants and bounded unary math functions", () => {
    expectCalculation(
      "sqrt(81) + abs(-3) + round(2.6) + floor(2.9) + ceil(2.1) + log(100) + ln(e)",
      23,
    );
    expectCalculationError("sin(pi / 2)", "Function sin is not supported.");
  });

  it("preserves tiny nonzero results in scientific notation", () => {
    expect(expectCalculation("1e-13", 1e-13).display).toBe("1e-13");
    expect(expectCalculation("-1e-13", -1e-13).display).toBe("-1e-13");
  });

  it("returns specific, user-safe errors for incomplete and invalid expressions", () => {
    expectCalculationError("", "Enter a calculation.");
    expectCalculationError("2 & 3", "Use numbers, parentheses, and the supported calculator keys.");
    expectCalculationError("1 +", "Finish the calculation before adding it.");
    expectCalculationError("(1 + 2", "Close every open parenthesis.");
    expectCalculationError("sqrt 9", "Use sqrt with parentheses.");
    expectCalculationError("mystery(1)", "Function mystery is not supported.");
  });

  it("rejects undefined domains, zero division, and unsafe powers", () => {
    expectCalculationError("1 / 0", "Cannot divide by zero.");
    expectCalculationError("sqrt(-1)", "Square root needs a value of zero or more.");
    expectCalculationError("ln(0)", "Natural log needs a value above zero.");
    expectCalculationError("log(-10)", "Log needs a value above zero.");
    expectCalculationError("(-8)^(1/3)", "This calculation has no real-number result.");
    expectCalculationError("0^0", "Zero to the power of zero is undefined.");
    expectCalculationError(
      "2^1001",
      "Power is too large. Keep the exponent between -1000 and 1000.",
    );
    expectCalculationError("10^101", "This result is too large. Use smaller values.");
    expectCalculationError("1e309", "This number is too large. Use a smaller value.");
  });

  it("enforces expression-length and parser-depth bounds", () => {
    expectCalculationError(
      `${"1+".repeat(80)}1`,
      "Calculation is too long. Keep it under 160 characters.",
    );

    const nested = `${"(".repeat(50)}1${")".repeat(50)}`;
    expectCalculationError(
      nested,
      "Calculation is too deeply nested. Remove a few parentheses.",
    );
  });
});

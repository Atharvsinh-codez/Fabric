import { describe, expect, it } from "vitest";

import { getSafeReturnPath } from "./safe-return";

describe("getSafeReturnPath", () => {
  it("keeps valid Fabric app destinations", () => {
    expect(getSafeReturnPath("/app")).toBe("/app");
    expect(getSafeReturnPath("/app/product-studio?view=recent")).toBe(
      "/app/product-studio?view=recent",
    );
  });

  it("keeps only strict token-shaped public share destinations", () => {
    const token = "a".repeat(43);
    expect(getSafeReturnPath(`/share/${token}`)).toBe(`/share/${token}`);
  });

  it.each([
    "https://example.com/app",
    "//example.com/app",
    "/\\example.com/app",
    "/%5Cexample.com/app",
    "/pricing",
    "/login",
    `/share/${"a".repeat(42)}`,
    `/share/${"a".repeat(44)}`,
    `/share/${"a".repeat(43)}?panel=comments`,
    `/share/${"a".repeat(43)}#comments`,
    `/share/${"a".repeat(43)}/comments`,
    `/share/${"a".repeat(42)}%2F`,
    "/app\u0000/product-studio",
  ])("rejects unsafe or out-of-scope destination %s", (candidate) => {
    expect(getSafeReturnPath(candidate)).toBe("/app");
  });

  it("uses the caller's trusted fallback for absent and repeated values", () => {
    expect(getSafeReturnPath(undefined, "/app/onboarding")).toBe("/app/onboarding");
    expect(getSafeReturnPath(["/app", "/app/account"], "/app/onboarding")).toBe(
      "/app/onboarding",
    );
  });
});

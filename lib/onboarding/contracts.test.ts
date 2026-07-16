import { describe, expect, it } from "vitest";

import { CompleteOnboardingSchema } from "./contracts";

const validInput = {
  displayName: "Jordan Davis",
  workspaceName: "Product studio",
  boardTitle: "Product planning starter",
  document: { version: 1, nodes: [], edges: [] },
};

describe("CompleteOnboardingSchema", () => {
  it("accepts a bounded starter board", () => {
    expect(CompleteOnboardingSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects blank identity and workspace names", () => {
    const result = CompleteOnboardingSchema.safeParse({
      ...validInput,
      displayName: " ",
      workspaceName: " ",
    });

    expect(result.success).toBe(false);
  });
});

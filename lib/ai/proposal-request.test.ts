import { describe, expect, it } from "vitest";

import { AiProposalRequestSchema } from "./proposal-request";

const baseRequest = {
  skill: "cluster-by-theme" as const,
  workspaceId: "workspace-1",
  boardId: "board-1",
  documentGenerationId: "generation-1",
  durableSequence: 2,
  instruction: "Review this evidence.",
};

const node = {
  id: "node-1",
  type: "note" as const,
  title: "Evidence",
  x: 0,
  y: 0,
  width: 180,
  height: 120,
};

describe("AI proposal mode selection bounds", () => {
  it("allows feedback on one supported object", () => {
    expect(
      AiProposalRequestSchema.safeParse({
        ...baseRequest,
        mode: "feedback",
        selection: [node],
      }).success,
    ).toBe(true);
  });

  it.each(["suggest", "solve"] as const)(
    "requires at least two objects for %s",
    (mode) => {
      const result = AiProposalRequestSchema.safeParse({
        ...baseRequest,
        mode,
        selection: [node],
      });
      expect(result.success).toBe(false);
    },
  );

  it("keeps legacy requests on suggest's two-object boundary", () => {
    expect(
      AiProposalRequestSchema.safeParse({ ...baseRequest, selection: [node] }).success,
    ).toBe(false);
  });
});

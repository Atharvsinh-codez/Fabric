import { describe, expect, it } from "vitest";

import { AiProposalRequestSchema } from "./proposal-request";

const baseRequest = {
  skill: "canvas-agent" as const,
  workspaceId: "workspace-1",
  boardId: "board-1",
  documentGenerationId: "generation-1",
  durableSequence: 2,
  instruction: "Solve this on the canvas.",
  viewport: { x: -200, y: 40, width: 1_280, height: 720 },
  conversation: [],
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

describe("canvas-agent proposal request bounds", () => {
  it("allows an empty selection so the agent can work in the viewport", () => {
    expect(
      AiProposalRequestSchema.safeParse({ ...baseRequest, selection: [] }).success,
    ).toBe(true);
  });

  it("accepts images as selectable source material", () => {
    expect(
      AiProposalRequestSchema.safeParse({
        ...baseRequest,
        selection: [{ ...node, type: "image" }],
      }).success,
    ).toBe(true);
  });

  it("accepts strictly bounded draw geometry", () => {
    expect(
      AiProposalRequestSchema.safeParse({
        ...baseRequest,
        selection: [
          {
            ...node,
            type: "drawing",
            source: {
              shapeType: "draw",
              segments: [
                {
                  type: "free",
                  points: [
                    { x: 0, y: 0, z: 0.5 },
                    { x: 25, y: 10, z: 0.7 },
                  ],
                },
              ],
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects vector source fields on non-drawing nodes", () => {
    const result = AiProposalRequestSchema.safeParse({
      ...baseRequest,
      selection: [
        {
          ...node,
          source: {
            shapeType: "line",
            segments: [
              {
                type: "straight",
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 10 },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("caps selection at 40 and conversation at 12 bounded messages", () => {
    const selection = Array.from({ length: 41 }, (_, index) => ({
      ...node,
      id: `node-${index}`,
    }));
    expect(
      AiProposalRequestSchema.safeParse({ ...baseRequest, selection }).success,
    ).toBe(false);
    expect(
      AiProposalRequestSchema.safeParse({
        ...baseRequest,
        selection: [node],
        conversation: Array.from({ length: 13 }, () => ({
          role: "user",
          content: "Continue",
        })),
      }).success,
    ).toBe(false);
    expect(
      AiProposalRequestSchema.safeParse({
        ...baseRequest,
        selection: [node],
        conversation: [{ role: "assistant", content: "x".repeat(2_001) }],
      }).success,
    ).toBe(false);
  });
});

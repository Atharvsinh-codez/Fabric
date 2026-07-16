import { describe, expect, it } from "vitest";

import {
  CANVAS_AGENT_SKILL,
  MAX_BOARD_ASSISTANCE_WALL_TIME_MS,
  buildBoardAssistanceInput,
  getBoardAssistanceSkill,
} from "./board-assistance.v1";

const request = {
  skill: "canvas-agent" as const,
  workspaceId: "workspace-1",
  boardId: "board-1",
  documentGenerationId: "generation-1",
  durableSequence: 4,
  instruction: "Solve the equation and draw the decision flow.",
  viewport: { x: 100, y: 200, width: 1_200, height: 800 },
  conversation: [{ role: "user" as const, content: "Keep it concise." }],
  selection: [],
};

const base = {
  workspaceId: request.workspaceId,
  boardId: request.boardId,
  documentGenerationId: request.documentGenerationId,
  durableSequence: request.durableSequence,
  selectionHash: "a".repeat(64),
};

describe("canvas-agent skill", () => {
  it("uses one skill with native diagram and deterministic pen operations", () => {
    expect(getBoardAssistanceSkill()).toBe(CANVAS_AGENT_SKILL);
    expect(CANVAS_AGENT_SKILL.manifest.id).toBe("canvas-agent");
    expect(CANVAS_AGENT_SKILL.manifest.promptVersion).toBe("canvas-agent.prompt.v2");
    expect(CANVAS_AGENT_SKILL.manifest.allowedOperations).toEqual(
      expect.arrayContaining(["createNode", "createConnector", "writeText"]),
    );
    expect(CANVAS_AGENT_SKILL.allowedCreatedNodeTypes).toEqual(
      expect.arrayContaining(["diamond", "triangle", "hexagon"]),
    );
    expect(CANVAS_AGENT_SKILL.allowedCreatedNodeTypes).not.toContain("image");
  });

  it("keeps model execution within the 180-second canvas-agent deadline", () => {
    expect(CANVAS_AGENT_SKILL.manifest.limits.maxWallTimeMs).toBe(180_000);
    expect(MAX_BOARD_ASSISTANCE_WALL_TIME_MS).toBe(180_000);
  });

  it("forbids raster output and requires pen answers plus human approval", () => {
    expect(CANVAS_AGENT_SKILL.systemInstruction).toContain(
      "Answer questions, show reasoning, and write equations with writeText",
    );
    expect(CANVAS_AGENT_SKILL.systemInstruction).toContain(
      "Never create, replace, synthesize, or modify an image",
    );
    const input = JSON.parse(buildBoardAssistanceInput(request, base)) as {
      viewport: typeof request.viewport;
      selectedNodes: unknown[];
      outputRules: {
        humanApprovalRequired: boolean;
        autoApply: boolean;
        imageCreationAllowed: boolean;
        rasterOutputAllowed: boolean;
        canonicalContract: {
          rootKeys: string[];
          forbiddenOperationAliases: string[];
        };
      };
    };
    expect(input.viewport).toEqual(request.viewport);
    expect(input.selectedNodes).toEqual([]);
    expect(input.outputRules).toMatchObject({
      humanApprovalRequired: true,
      autoApply: false,
      imageCreationAllowed: false,
      rasterOutputAllowed: false,
      canonicalContract: {
        rootKeys: ["schemaVersion", "summary", "base", "operations"],
        forbiddenOperationAliases: ["ops", "id", "top-level x", "top-level y"],
      },
    });
  });
});

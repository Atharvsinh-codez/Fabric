import { describe, expect, it } from "vitest";

import {
  BOARD_ASSISTANCE_SKILLS,
  buildBoardAssistanceInput,
  getBoardAssistanceSkill,
} from "./board-assistance.v1";

const request = {
  skill: "cluster-by-theme" as const,
  mode: "feedback" as const,
  workspaceId: "workspace-1",
  boardId: "board-1",
  documentGenerationId: "generation-1",
  durableSequence: 4,
  instruction: "Find contradictions.",
  selection: [
    {
      id: "node-1",
      type: "note" as const,
      title: "Evidence",
      x: 0,
      y: 0,
      width: 180,
      height: 120,
    },
  ],
};

const base = {
  workspaceId: request.workspaceId,
  boardId: request.boardId,
  documentGenerationId: request.documentGenerationId,
  durableSequence: request.durableSequence,
  selectionHash: "a".repeat(64),
};

describe("board assistance skills", () => {
  it("gives each mode a distinct, least-capability patch policy", () => {
    expect(BOARD_ASSISTANCE_SKILLS.feedback.manifest.allowedOperations).toEqual([
      "createNode",
    ]);
    expect(BOARD_ASSISTANCE_SKILLS.feedback.manifest.thinkingLevel).toBe("medium");
    expect(BOARD_ASSISTANCE_SKILLS.feedback.allowedCreatedNodeTypes).toEqual([
      "summary",
    ]);
    expect(BOARD_ASSISTANCE_SKILLS.suggest.manifest.allowedOperations).toEqual([
      "createNode",
      "moveNode",
    ]);
    expect(BOARD_ASSISTANCE_SKILLS.suggest.manifest.thinkingLevel).toBe("medium");
    expect(BOARD_ASSISTANCE_SKILLS.solve.manifest.allowedOperations).toEqual([
      "createNode",
      "moveNode",
      "createConnector",
    ]);
    expect(BOARD_ASSISTANCE_SKILLS.solve.manifest.thinkingLevel).toBe("high");
    expect(BOARD_ASSISTANCE_SKILLS.solve.allowedCreatedNodeTypes).toEqual([
      "frame",
      "summary",
    ]);
    expect(
      Object.values(BOARD_ASSISTANCE_SKILLS).map(
        (skill) => skill.manifest.limits.maxOutputTokens,
      ),
    ).toEqual([16_384, 16_384, 16_384]);
    expect(
      Object.values(BOARD_ASSISTANCE_SKILLS).map(
        (skill) => skill.manifest.limits.maxRetries,
      ),
    ).toEqual([0, 0, 0]);
  });

  it("puts the selected mode and human-approval boundary in model input", () => {
    const input = JSON.parse(buildBoardAssistanceInput(request, base)) as {
      assistanceMode: string;
      outputRules: { humanApprovalRequired: boolean; autoApply: boolean };
    };
    expect(input.assistanceMode).toBe("feedback");
    expect(input.outputRules).toMatchObject({
      humanApprovalRequired: true,
      autoApply: false,
    });
    expect(getBoardAssistanceSkill("feedback").systemInstruction).toContain(
      "Do not move, reparent, connect, or modify any selected source node.",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  CANVAS_AGENT_SKILL,
  MAX_BOARD_ASSISTANCE_INPUT_BYTES,
  MAX_BOARD_ASSISTANCE_WALL_TIME_MS,
  buildBoardAssistanceInput,
  buildBoardAssistanceTurnInput,
  getBoardAssistanceSkill,
} from "./board-assistance.v1";
import { buildAuthorizedBoardScene } from "../engine/authorized-scene";
import type { AiProposalRequest } from "../proposal-request";
import type { CanvasNode } from "../../types";

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

describe("canvas-agent skill", () => {
  it("uses one semantic planner whose output is compiled into native operations", () => {
    expect(getBoardAssistanceSkill()).toBe(CANVAS_AGENT_SKILL);
    expect(CANVAS_AGENT_SKILL.manifest.id).toBe("canvas-agent");
    expect(CANVAS_AGENT_SKILL.manifest.version).toBe("2.0.0");
    expect(CANVAS_AGENT_SKILL.manifest.promptVersion).toBe("canvas-agent.plan.v2");
    expect(CANVAS_AGENT_SKILL.manifest.allowedOperations).toEqual(
      expect.arrayContaining(["createNode", "createConnector", "updateNode", "moveNode"]),
    );
    expect(CANVAS_AGENT_SKILL.manifest.allowedOperations).not.toContain("writeText");
    expect(CANVAS_AGENT_SKILL.allowedCreatedNodeTypes).toEqual(
      expect.arrayContaining(["diamond", "triangle", "hexagon"]),
    );
    expect(CANVAS_AGENT_SKILL.allowedCreatedNodeTypes).not.toContain("image");
  });

  it("uses a compact fast plan budget instead of the former 16k/180s patch budget", () => {
    expect(CANVAS_AGENT_SKILL.manifest.limits.maxOutputTokens).toBe(4_096);
    expect(CANVAS_AGENT_SKILL.manifest.limits.maxWallTimeMs).toBe(60_000);
    expect(MAX_BOARD_ASSISTANCE_WALL_TIME_MS).toBe(60_000);
  });

  it("forbids low-level geometry/raster output and preserves exact text", () => {
    expect(CANVAS_AGENT_SKILL.systemInstruction).toContain(
      'presentation "typed" for all answers, prose, math, equations',
    );
    expect(CANVAS_AGENT_SKILL.systemInstruction).toContain(
      "Fabric—not you—assigns coordinates",
    );
    const rawInput = buildBoardAssistanceInput(request);
    const input = JSON.parse(rawInput) as {
      scene: { viewport: typeof request.viewport; nodes: unknown[]; writableHandles: string[] };
      outputRules: {
        humanApprovalRequired: boolean;
        autoApply: boolean;
        imageCreationAllowed: boolean;
        rasterOutputAllowed: boolean;
        result: string;
        providerOwns: string[];
        fabricOwns: string[];
      };
    };
    expect(input.scene.viewport).toEqual(request.viewport);
    expect(input.scene.nodes).toEqual([]);
    expect(input.scene.writableHandles).toEqual([]);
    expect(input.outputRules).toMatchObject({
      result: "BoardPlan",
      humanApprovalRequired: true,
      autoApply: false,
      imageCreationAllowed: false,
      rasterOutputAllowed: false,
    });
    expect(rawInput).not.toContain(request.workspaceId);
    expect(rawInput).not.toContain(request.boardId);
    expect(rawInput).not.toContain(request.documentGenerationId);
    expect(input.outputRules.fabricOwns).toContain("coordinates");
  });

  it("bounds worst-case scene and conversation context before the provider call", () => {
    const nodes: CanvasNode[] = Array.from({ length: 80 }, (_, index) => ({
      id: `node-${String(index).padStart(3, "0")}`,
      type: "note",
      title: `Node ${index} ${"title ".repeat(24)}`,
      body: `${index}: ${"context ".repeat(500)}`,
      x: index * 8,
      y: 10,
      width: 120,
      height: 90,
      fill: "yellow",
    }));
    const selection = nodes.slice(0, 40).map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      body: node.body,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    }));
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes, edges: [] },
      selection,
      viewport: { x: 0, y: 0, width: 1_200, height: 800 },
    });
    const worstCase: AiProposalRequest = {
      ...request,
      instruction: "🧠".repeat(1_000),
      conversation: Array.from({ length: 12 }, (_, index) => ({
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        content: `${index}:${"🧠".repeat(999)}`,
      })),
      selection,
      scene,
    };

    const result = buildBoardAssistanceTurnInput(worstCase);
    expect(result.metrics.inputBytes).toBe(
      new TextEncoder().encode(result.input).byteLength,
    );
    expect(result.metrics.inputBytes).toBeLessThanOrEqual(MAX_BOARD_ASSISTANCE_INPUT_BYTES);
    expect(result.metrics.sceneTextCharactersOmitted).toBeGreaterThan(0);
    expect(result.metrics.conversationMessagesOmitted).toBeGreaterThan(0);
  });
});

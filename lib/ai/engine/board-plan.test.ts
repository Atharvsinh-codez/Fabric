import { describe, expect, it } from "vitest";

import {
  BOARD_PLAN_ENUM_DOMAINS,
  BOARD_PLAN_JSON_SCHEMA,
  BOARD_PLAN_LIMITS,
  BoardPlanSchema,
  type BoardPlan,
} from "./board-plan";

const completeProposal = {
  schemaVersion: 1,
  kind: "proposal",
  summary: "Answer the question, add supporting cards, and organize the selected work.",
  placement: "selection-right",
  flow: "vertical",
  actions: [
    {
      kind: "composeText",
      key: "worked_answer",
      presentation: "typed",
      blocks: [
        { role: "heading", text: "Solve 2x + 4 = 12" },
        { role: "equation", text: "2x = 8" },
        { role: "answer", text: "x = 4" },
      ],
      tone: "blue",
    },
    {
      kind: "addCards",
      cards: [
        {
          key: "assumption",
          variant: "note",
          title: "Assumption",
          body: "x is a real number.",
          tone: "yellow",
        },
        {
          key: "result",
          variant: "summary",
          title: "Result",
          body: "The solution is x = 4.",
          tone: "green",
        },
      ],
    },
    {
      kind: "addShapes",
      shapes: [
        {
          key: "decision",
          shape: "diamond",
          label: "Check the result",
          detail: "Substitute x into the original equation.",
          tone: "purple",
        },
      ],
    },
    {
      kind: "addDiagram",
      key: "verification_flow",
      title: "Verification",
      layout: "flow-horizontal",
      nodes: [
        { key: "substitute", shape: "rectangle", label: "Substitute x = 4" },
        { key: "compare", shape: "diamond", label: "Does 12 = 12?" },
        { key: "done", shape: "summary", label: "Solution verified", tone: "green" },
      ],
      connections: [
        { from: "substitute", to: "compare" },
        { from: "compare", to: "done", label: "yes" },
      ],
    },
    {
      kind: "arrangeSelection",
      selectionRefs: ["shape:first", "shape:second"],
      arrangement: "row",
      spacing: "comfortable",
    },
    {
      kind: "editSelection",
      edits: [
        {
          selectionRef: "shape:first",
          title: "Known values",
          body: "2x + 4 = 12",
          tag: "input",
        },
      ],
    },
    {
      kind: "styleSelection",
      selectionRefs: ["shape:first", "shape:second"],
      style: { tone: "neutral", textTone: "dark" },
    },
  ],
} as const;

describe("BoardPlan v1", () => {
  it("accepts a compiler-ready proposal covering every semantic action family", () => {
    const result = BoardPlanSchema.safeParse(completeProposal);

    expect(result.success).toBe(true);
    if (result.success && result.data.kind === "proposal") {
      expect(result.data.actions).toHaveLength(7);
    }
  });

  it("accepts a clarification without any canvas mutation instructions", () => {
    const plan: BoardPlan = {
      schemaVersion: 1,
      kind: "clarification",
      reason: "missing-selection",
      question: "Which cards should I arrange?",
      choices: ["Use my current selection", "Create a new group"],
    };

    expect(BoardPlanSchema.parse(plan)).toEqual(plan);
  });

  it("rejects tenant scope, absolute geometry, patch operations, and temporary IDs", () => {
    const withTenantScope = { ...completeProposal, workspaceId: "workspace-secret" };
    const withCoordinates = structuredClone(completeProposal) as Record<string, unknown>;
    const coordinateActions = withCoordinates.actions as Array<Record<string, unknown>>;
    coordinateActions[0] = { ...coordinateActions[0], x: 100, y: 200 };
    const withPatchOperation = {
      ...completeProposal,
      actions: [{ kind: "createNode", tempId: "tmp_model", position: { x: 1, y: 2 } }],
    };
    const withTemporarySelectionRef = {
      ...completeProposal,
      actions: [
        {
          kind: "styleSelection",
          selectionRefs: ["tmp_model"],
          style: { tone: "blue" },
        },
      ],
    };
    const withTemporaryLogicalKey = {
      ...completeProposal,
      actions: [
        {
          kind: "composeText",
          key: "tmp_model",
          presentation: "typed",
          blocks: [{ role: "body", text: "No temporary IDs." }],
        },
      ],
    };

    expect(BoardPlanSchema.safeParse(withTenantScope).success).toBe(false);
    expect(BoardPlanSchema.safeParse(withCoordinates).success).toBe(false);
    expect(BoardPlanSchema.safeParse(withPatchOperation).success).toBe(false);
    expect(BoardPlanSchema.safeParse(withTemporarySelectionRef).success).toBe(false);
    expect(BoardPlanSchema.safeParse(withTemporaryLogicalKey).success).toBe(false);
  });

  it("rejects unknown fields at every nested contract boundary", () => {
    const candidate = structuredClone(completeProposal) as Record<string, unknown>;
    const actions = candidate.actions as Array<Record<string, unknown>>;
    const cardsAction = actions[1];
    const cards = cardsAction.cards as Array<Record<string, unknown>>;
    cards[0].nodeId = "shape:not-authorized";

    expect(BoardPlanSchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects provider-invented diagram and arrangement aliases", () => {
    const diagramNodeRoleAlias = {
      ...completeProposal,
      actions: [
        {
          kind: "addDiagram",
          key: "flow",
          layout: "flow-horizontal",
          nodes: [
            { key: "start", role: "start", label: "Start" },
            { key: "finish", role: "end", label: "Finish" },
          ],
          connections: [{ from: "start", to: "finish" }],
        },
      ],
    };
    const diagramNodeExtraRole = {
      ...completeProposal,
      actions: [
        {
          kind: "addDiagram",
          key: "flow",
          layout: "flow-horizontal",
          nodes: [
            { key: "start", shape: "ellipse", role: "start", label: "Start" },
            { key: "finish", shape: "rectangle", role: "end", label: "Finish" },
          ],
          connections: [{ from: "start", to: "finish" }],
        },
      ],
    };
    const arrangementAliases = {
      ...completeProposal,
      actions: [
        {
          kind: "arrangeSelection",
          selectionRefs: ["s1", "s2"],
          layout: "grid",
          columns: 2,
        },
      ],
    };
    const arrangementExtraAliases = {
      ...completeProposal,
      actions: [
        {
          kind: "arrangeSelection",
          selectionRefs: ["s1", "s2"],
          arrangement: "grid",
          spacing: "comfortable",
          layout: "grid",
          columns: 2,
        },
      ],
    };
    const inventedMindMapEnums = {
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create a mind map.",
      placement: "viewport-center",
      flow: "radial",
      actions: [
        {
          kind: "addDiagram",
          key: "map",
          layout: "radial",
          nodes: [
            { key: "root", shape: "ellipse", label: "Root" },
            { key: "branch", shape: "note", label: "Branch" },
          ],
          connections: [{ from: "root", to: "branch" }],
        },
      ],
    };

    expect(BoardPlanSchema.safeParse(diagramNodeRoleAlias).success).toBe(false);
    expect(BoardPlanSchema.safeParse(diagramNodeExtraRole).success).toBe(false);
    expect(BoardPlanSchema.safeParse(arrangementAliases).success).toBe(false);
    expect(BoardPlanSchema.safeParse(arrangementExtraAliases).success).toBe(false);
    expect(BoardPlanSchema.safeParse(inventedMindMapEnums).success).toBe(false);
  });

  it("rejects duplicate or dangling diagram keys and self-connections", () => {
    const diagramBase = {
      ...completeProposal,
      actions: [
        {
          kind: "addDiagram",
          key: "flow",
          layout: "hierarchy",
          nodes: [
            { key: "start", shape: "ellipse", label: "Start" },
            { key: "finish", shape: "ellipse", label: "Finish" },
          ],
          connections: [{ from: "start", to: "finish" }],
        },
      ],
    };
    const duplicateNode = structuredClone(diagramBase);
    duplicateNode.actions[0].nodes[1].key = "start";
    const danglingConnection = structuredClone(diagramBase);
    danglingConnection.actions[0].connections[0].to = "missing";
    const selfConnection = structuredClone(diagramBase);
    selfConnection.actions[0].connections[0].to = "start";

    expect(BoardPlanSchema.safeParse(diagramBase).success).toBe(true);
    expect(BoardPlanSchema.safeParse(duplicateNode).success).toBe(false);
    expect(BoardPlanSchema.safeParse(danglingConnection).success).toBe(false);
    expect(BoardPlanSchema.safeParse(selfConnection).success).toBe(false);
  });

  it("rejects duplicate top-level keys and duplicate selection references", () => {
    const duplicateKey = {
      ...completeProposal,
      actions: [
        {
          kind: "composeText",
          key: "result",
          presentation: "typed",
          blocks: [{ role: "answer", text: "First" }],
        },
        {
          kind: "addCards",
          cards: [{ key: "result", variant: "summary", title: "Second" }],
        },
      ],
    };
    const duplicateSelectionRef = {
      ...completeProposal,
      actions: [
        {
          kind: "arrangeSelection",
          selectionRefs: ["shape:one", "shape:one"],
          arrangement: "row",
          spacing: "compact",
        },
      ],
    };

    expect(BoardPlanSchema.safeParse(duplicateKey).success).toBe(false);
    expect(BoardPlanSchema.safeParse(duplicateSelectionRef).success).toBe(false);
  });

  it("rejects empty selection edits and empty styles", () => {
    const emptyEdit = {
      ...completeProposal,
      actions: [{ kind: "editSelection", edits: [{ selectionRef: "shape:one" }] }],
    };
    const emptyStyle = {
      ...completeProposal,
      actions: [
        { kind: "styleSelection", selectionRefs: ["shape:one"], style: {} },
      ],
    };

    expect(BoardPlanSchema.safeParse(emptyEdit).success).toBe(false);
    expect(BoardPlanSchema.safeParse(emptyStyle).success).toBe(false);
  });

  it("enforces aggregate generation, reference, and content limits", () => {
    const tooManyGeneratedElements = {
      ...completeProposal,
      actions: [
        ...Array.from({ length: 3 }, (_, batchIndex) => ({
          kind: "addCards",
          cards: Array.from({ length: 16 }, (_, cardIndex) => ({
            key: `card_${batchIndex}_${cardIndex}`,
            variant: "note",
            title: `Card ${batchIndex}-${cardIndex}`,
          })),
        })),
      ],
    };
    const tooManySelectionReferences = {
      ...completeProposal,
      actions: [
        ...Array.from({ length: 3 }, (_, batchIndex) => ({
          kind: "styleSelection",
          selectionRefs: Array.from(
            { length: 30 },
            (_, refIndex) => `shape:${batchIndex}-${refIndex}`,
          ),
          style: { tone: "blue" },
        })),
      ],
    };
    const tooMuchText = {
      ...completeProposal,
      actions: Array.from({ length: 11 }, (_, index) => ({
        kind: "composeText",
        key: `text_${index}`,
        presentation: "typed",
        blocks: [{ role: "body", text: "x".repeat(900) }],
      })),
    };

    expect(BOARD_PLAN_LIMITS.maxGeneratedElements).toBe(40);
    expect(BoardPlanSchema.safeParse(tooManyGeneratedElements).success).toBe(false);
    expect(BoardPlanSchema.safeParse(tooManySelectionReferences).success).toBe(false);
    expect(BoardPlanSchema.safeParse(tooMuchText).success).toBe(false);
  });

  it("budgets deterministic connection-note nodes at the exact 100-operation boundary", () => {
    const references = Array.from({ length: 40 }, (_, index) => `s${index + 1}`);
    const diagrams = Array.from({ length: 4 }, (_, index) => ({
      kind: "addDiagram",
      key: `flow_${index}`,
      layout: "hierarchy",
      nodes: [
        { key: "source", shape: "rectangle", label: `Source ${index}` },
        { key: "target", shape: "rectangle", label: `Target ${index}` },
      ],
      connections: [{
        from: "source",
        to: "target",
        label: "requires a reviewed handoff",
      }],
    }));
    const exactBoundary = {
      ...completeProposal,
      placement: "viewport-center",
      actions: [
        ...diagrams,
        {
          kind: "arrangeSelection",
          selectionRefs: references,
          arrangement: "grid",
          spacing: "compact",
        },
        {
          kind: "styleSelection",
          selectionRefs: references,
          style: { tone: "blue" },
        },
      ],
    };
    const overBoundary = {
      ...exactBoundary,
      actions: [
        ...exactBoundary.actions,
        {
          kind: "addCards",
          cards: [{ key: "overflow", variant: "note", title: "One operation too many" }],
        },
      ],
    };

    expect(BoardPlanSchema.safeParse(exactBoundary).success).toBe(true);
    const overResult = BoardPlanSchema.safeParse(overBoundary);
    expect(overResult.success).toBe(false);
    if (!overResult.success) {
      expect(overResult.error.issues.map((issue) => issue.message)).toContain(
        `Plan can compile to at most ${BOARD_PLAN_LIMITS.maxCompiledOperations} operations`,
      );
    }
  });

  it("rejects blank generated bodies while preserving explicit selection-body clearing", () => {
    const blankGeneratedBody = {
      ...completeProposal,
      actions: [{
        kind: "addCards",
        cards: [{ key: "blank", variant: "note", title: "Keep", body: "   " }],
      }],
    };
    const clearExistingBody = {
      ...completeProposal,
      actions: [{
        kind: "editSelection",
        edits: [{ selectionRef: "s1", body: "" }],
      }],
    };

    expect(BoardPlanSchema.safeParse(blankGeneratedBody).success).toBe(false);
    expect(BoardPlanSchema.safeParse(clearExistingBody).success).toBe(true);
  });

  it("exports one strict draft-7 provider schema generated from the runtime contract", () => {
    expect(Object.isFrozen(BOARD_PLAN_JSON_SCHEMA)).toBe(true);
    expect(BOARD_PLAN_JSON_SCHEMA.$schema).toBe("http://json-schema.org/draft-07/schema#");

    const serialized = JSON.stringify(BOARD_PLAN_JSON_SCHEMA);
    expect(serialized).toContain('"additionalProperties":false');
    expect(serialized).toContain("Canonical diagram-node field");
    expect(serialized).toContain("Canonical arrangement field");
    for (const domain of Object.values(BOARD_PLAN_ENUM_DOMAINS)) {
      expect(serialized).toContain(`"enum":${JSON.stringify(domain)}`);
    }
    expect(serialized).toContain('"const":"proposal"');
    expect(serialized).toContain('"const":"clarification"');
    expect(serialized).not.toContain("workspaceId");
    expect(serialized).not.toContain("boardId");
    expect(serialized).not.toContain("documentGenerationId");
    expect(serialized).not.toContain("durableSequence");
    expect(serialized).not.toContain("tempId");
    expect(serialized).not.toContain("createNode");
    expect(serialized).not.toContain('"position"');
    expect(serialized).not.toContain('"operations"');
  });
});

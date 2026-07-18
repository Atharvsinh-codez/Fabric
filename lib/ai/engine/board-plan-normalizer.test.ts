import { describe, expect, it } from "vitest";

import { BoardPlanSchema } from "./board-plan";
import { normalizeBoardPlanCandidate } from "./board-plan-normalizer";

const proposalBase = {
  schemaVersion: 1,
  kind: "proposal",
  summary: "Build a clear plan.",
  placement: "viewport-center",
  flow: "vertical",
} as const;

function textBlocks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    role: "body",
    text: `Step ${index + 1}`,
  }));
}

describe("BoardPlan provider compatibility", () => {
  it("returns an identity-equivalent clone for canonical plans", () => {
    const canonical = {
      ...proposalBase,
      actions: [{
        kind: "composeText",
        key: "plan",
        presentation: "typed",
        blocks: textBlocks(2),
      }],
    };

    const normalized = normalizeBoardPlanCandidate(canonical);

    expect(normalized).toEqual({
      value: canonical,
      compatibilityMode: "none",
    });
    expect(normalized.value).not.toBe(canonical);
    expect((normalized.value as { actions: unknown[] }).actions).not.toBe(canonical.actions);
  });

  it("fills only missing safe defaults and removes only supported empty optionals", () => {
    const candidate = {
      ...proposalBase,
      actions: [
        {
          kind: "composeText",
          key: "overview",
          blocks: [{ role: "body", text: "Overview" }],
        },
        {
          kind: "addCards",
          cards: [{ key: "card", title: "Card", body: "" }],
        },
        {
          kind: "addShapes",
          shapes: [{ key: "shape", shape: "rectangle", label: "Shape", detail: "" }],
        },
        {
          kind: "addDiagram",
          key: "flow",
          title: "",
          layout: "flow-horizontal",
          nodes: [
            { key: "start", label: "Start", detail: "" },
            { key: "finish", shape: "rectangle", label: "Finish" },
          ],
          connections: [{ from: "start", to: "finish", label: "" }],
        },
      ],
    };

    const normalized = normalizeBoardPlanCandidate(candidate);

    expect(normalized.compatibilityMode).toBe("safe_defaults_and_batches_v1");
    expect(normalized.value).toMatchObject({
      actions: [
        { presentation: "typed" },
        { cards: [{ key: "card", title: "Card", variant: "note" }] },
        { shapes: [{ key: "shape", shape: "rectangle", label: "Shape" }] },
        {
          nodes: [
            { key: "start", shape: "rectangle", label: "Start" },
            { key: "finish", shape: "rectangle", label: "Finish" },
          ],
          connections: [{ from: "start", to: "finish" }],
        },
      ],
    });
    expect(BoardPlanSchema.safeParse(normalized.value).success).toBe(true);
    expect(candidate.actions[0]).not.toHaveProperty("presentation");
    expect(
      (candidate.actions[1] as { cards: Array<{ body: string }> }).cards[0],
    ).toHaveProperty("body", "");
  });

  it("defaults missing clarification choices but preserves an explicit invalid value", () => {
    const missingChoices = {
      schemaVersion: 1,
      kind: "clarification",
      reason: "ambiguous",
      question: "Which plan should I create?",
    };
    const explicitInvalid = { ...missingChoices, choices: null };

    expect(normalizeBoardPlanCandidate(missingChoices)).toEqual({
      value: { ...missingChoices, choices: [] },
      compatibilityMode: "safe_defaults_and_batches_v1",
    });
    expect(normalizeBoardPlanCandidate(explicitInvalid)).toEqual({
      value: explicitInvalid,
      compatibilityMode: "none",
    });
  });

  it("losslessly splits oversized text blocks with bounded deterministic keys", () => {
    const longKey = "a".repeat(48);
    const candidate = {
      ...proposalBase,
      actions: [{
        kind: "composeText",
        key: longKey,
        presentation: "typed",
        blocks: textBlocks(25),
      }],
    };

    const first = normalizeBoardPlanCandidate(candidate);
    const second = normalizeBoardPlanCandidate(candidate);
    const actions = (first.value as { actions: Array<{ key: string; blocks: unknown[] }> }).actions;

    expect(first).toEqual(second);
    expect(first.compatibilityMode).toBe("safe_defaults_and_batches_v1");
    expect(actions.map((action) => action.blocks.length)).toEqual([12, 12, 1]);
    expect(actions.map((action) => action.key)).toEqual([
      longKey,
      `${"a".repeat(41)}_part_2`,
      `${"a".repeat(41)}_part_3`,
    ]);
    expect(actions.every((action) => action.key.length <= 48)).toBe(true);
    expect(actions.flatMap((action) => action.blocks)).toEqual(textBlocks(25));
    expect(BoardPlanSchema.safeParse(first.value).success).toBe(true);
  });

  it("avoids existing plan-key collisions while splitting text blocks", () => {
    const candidate = {
      ...proposalBase,
      actions: [
        {
          kind: "composeText",
          key: "plan",
          presentation: "typed",
          blocks: textBlocks(13),
        },
        {
          kind: "composeText",
          key: "plan_part_2",
          presentation: "typed",
          blocks: [{ role: "body", text: "Existing content" }],
        },
      ],
    };

    const normalized = normalizeBoardPlanCandidate(candidate);
    const keys = (normalized.value as { actions: Array<{ key: string }> }).actions
      .map((action) => action.key);

    expect(keys).toEqual(["plan", "plan_part_2_2", "plan_part_2"]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(BoardPlanSchema.safeParse(normalized.value).success).toBe(true);
  });

  it("splits card and shape batches without changing their content or order", () => {
    const cards = Array.from({ length: 17 }, (_, index) => ({
      key: `card_${index}`,
      variant: "note",
      title: `Card ${index}`,
    }));
    const shapes = Array.from({ length: 17 }, (_, index) => ({
      key: `shape_${index}`,
      shape: "rectangle",
      label: `Shape ${index}`,
    }));
    const candidate = {
      ...proposalBase,
      actions: [
        { kind: "addCards", cards },
        { kind: "addShapes", shapes },
      ],
    };

    const normalized = normalizeBoardPlanCandidate(candidate);
    const actions = (normalized.value as {
      actions: Array<{ kind: string; cards?: unknown[]; shapes?: unknown[] }>;
    }).actions;

    expect(actions.map((action) => [
      action.kind,
      action.cards?.length ?? action.shapes?.length,
    ])).toEqual([
      ["addCards", 16],
      ["addCards", 1],
      ["addShapes", 16],
      ["addShapes", 1],
    ]);
    expect(actions.filter((action) => action.cards).flatMap((action) => action.cards)).toEqual(cards);
    expect(actions.filter((action) => action.shapes).flatMap((action) => action.shapes)).toEqual(shapes);
    expect(BoardPlanSchema.safeParse(normalized.value).success).toBe(true);
  });

  it("never drops unknown fields or repairs aliases and explicit invalid values", () => {
    const candidate = {
      ...proposalBase,
      actions: [
        {
          kind: "composeText",
          key: "overview",
          presentation: null,
          blocks: [{ role: "body", text: "Overview" }],
          html: "<p>Overview</p>",
        },
        {
          kind: "addCards",
          cards: [{ key: "card", variant: "", title: "Card", body: " " }],
        },
        {
          kind: "addDiagram",
          key: "flow",
          title: " ",
          layout: "flow-horizontal",
          nodes: [
            { key: "start", shape: null, label: "Start", detail: " " },
            { key: "finish", role: "rectangle", label: "Finish" },
          ],
          connections: [{ from: "start", to: "finish", label: " " }],
        },
      ],
    };

    const normalized = normalizeBoardPlanCandidate(candidate);

    expect(normalized.value).toMatchObject(candidate);
    expect(normalized.value).toMatchObject({
      actions: [
        { presentation: null, html: "<p>Overview</p>" },
        { cards: [{ variant: "", body: " " }] },
        {
          title: " ",
          nodes: [
            { shape: null, detail: " " },
            { role: "rectangle", shape: "rectangle" },
          ],
          connections: [{ label: " " }],
        },
      ],
    });
    expect(BoardPlanSchema.safeParse(normalized.value).success).toBe(false);
  });

  it("does not invent a missing or invalid key to make oversized text valid", () => {
    const candidate = {
      ...proposalBase,
      actions: [{
        kind: "composeText",
        presentation: "typed",
        blocks: textBlocks(13),
      }],
    };

    const normalized = normalizeBoardPlanCandidate(candidate);

    expect((normalized.value as { actions: unknown[] }).actions).toHaveLength(1);
    expect(normalized.compatibilityMode).toBe("none");
    expect(BoardPlanSchema.safeParse(normalized.value).success).toBe(false);
  });
});

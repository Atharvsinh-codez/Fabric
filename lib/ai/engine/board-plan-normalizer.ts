import {
  BOARD_PLAN_LIMITS,
  BoardPlanKeySchema,
} from "./board-plan";

const COMPATIBILITY_MODE = "safe_defaults_and_batches_v1" as const;
const MAX_PLAN_KEY_CHARACTERS = 48;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Provider candidates originate from JSON.parse, but keeping cloning local
 * makes the no-mutation contract explicit and independently testable.
 */
function cloneCandidate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneCandidate);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneCandidate(child)]),
  );
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function removeEmptyOptional(record: JsonRecord, key: string): boolean {
  if (record[key] !== "") return false;
  delete record[key];
  return true;
}

function collectPlanKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectPlanKeys(child, keys));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "key" && typeof child === "string") keys.add(child);
    collectPlanKeys(child, keys);
  }
}

function allocateSplitKey(
  baseKey: string,
  partNumber: number,
  usedKeys: Set<string>,
): string {
  let collisionNumber = 1;
  while (true) {
    const suffix = collisionNumber === 1
      ? `_part_${partNumber}`
      : `_part_${partNumber}_${collisionNumber}`;
    const prefix = baseKey.slice(0, MAX_PLAN_KEY_CHARACTERS - suffix.length);
    const candidate = `${prefix}${suffix}`;
    if (!usedKeys.has(candidate)) {
      usedKeys.add(candidate);
      return candidate;
    }
    collisionNumber += 1;
  }
}

function chunksOf<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function normalizeComposeTextAction(
  action: JsonRecord,
  usedKeys: Set<string>,
): { actions: JsonRecord[]; changed: boolean } {
  let changed = false;
  if (!hasOwn(action, "presentation")) {
    action.presentation = "typed";
    changed = true;
  }

  if (
    !Array.isArray(action.blocks) ||
    action.blocks.length <= BOARD_PLAN_LIMITS.maxTextBlocks ||
    !BoardPlanKeySchema.safeParse(action.key).success
  ) {
    return { actions: [action], changed };
  }

  const baseKey = action.key as string;
  const blockChunks = chunksOf(action.blocks, BOARD_PLAN_LIMITS.maxTextBlocks);
  return {
    changed: true,
    actions: blockChunks.map((blocks, index) => ({
      ...action,
      key: index === 0
        ? baseKey
        : allocateSplitKey(baseKey, index + 1, usedKeys),
      blocks,
    })),
  };
}

function normalizeCardsAction(action: JsonRecord): {
  actions: JsonRecord[];
  changed: boolean;
} {
  if (!Array.isArray(action.cards)) return { actions: [action], changed: false };

  let changed = false;
  for (const card of action.cards) {
    if (!isRecord(card)) continue;
    if (!hasOwn(card, "variant")) {
      card.variant = "note";
      changed = true;
    }
    changed = removeEmptyOptional(card, "body") || changed;
  }

  if (action.cards.length <= BOARD_PLAN_LIMITS.maxBatchItems) {
    return { actions: [action], changed };
  }
  return {
    changed: true,
    actions: chunksOf(action.cards, BOARD_PLAN_LIMITS.maxBatchItems).map((cards) => ({
      ...action,
      cards,
    })),
  };
}

function normalizeShapesAction(action: JsonRecord): {
  actions: JsonRecord[];
  changed: boolean;
} {
  if (!Array.isArray(action.shapes)) return { actions: [action], changed: false };

  let changed = false;
  for (const shape of action.shapes) {
    if (!isRecord(shape)) continue;
    changed = removeEmptyOptional(shape, "detail") || changed;
  }

  if (action.shapes.length <= BOARD_PLAN_LIMITS.maxBatchItems) {
    return { actions: [action], changed };
  }
  return {
    changed: true,
    actions: chunksOf(action.shapes, BOARD_PLAN_LIMITS.maxBatchItems).map((shapes) => ({
      ...action,
      shapes,
    })),
  };
}

function normalizeDiagramAction(action: JsonRecord): boolean {
  let changed = removeEmptyOptional(action, "title");

  if (Array.isArray(action.nodes)) {
    for (const node of action.nodes) {
      if (!isRecord(node)) continue;
      if (!hasOwn(node, "shape")) {
        node.shape = "rectangle";
        changed = true;
      }
      changed = removeEmptyOptional(node, "detail") || changed;
    }
  }

  if (Array.isArray(action.connections)) {
    for (const connection of action.connections) {
      if (!isRecord(connection)) continue;
      changed = removeEmptyOptional(connection, "label") || changed;
    }
  }
  return changed;
}

export type BoardPlanCandidateNormalization = Readonly<{
  value: unknown;
  compatibilityMode: "none" | typeof COMPATIBILITY_MODE;
}>;

/**
 * Repairs only semantically neutral JSON-schema drift observed from providers:
 * omitted presentation defaults, empty optional strings, and oversized batches
 * that can be losslessly divided. Unknown fields, aliases, and explicit invalid
 * values remain untouched for the strict BoardPlan validator to reject.
 */
export function normalizeBoardPlanCandidate(
  candidate: unknown,
): BoardPlanCandidateNormalization {
  const value = cloneCandidate(candidate);
  if (!isRecord(value)) return { value, compatibilityMode: "none" };

  let changed = false;
  if (value.kind === "clarification") {
    if (!hasOwn(value, "choices")) {
      value.choices = [];
      changed = true;
    }
    return {
      value,
      compatibilityMode: changed ? COMPATIBILITY_MODE : "none",
    };
  }
  if (value.kind !== "proposal" || !Array.isArray(value.actions)) {
    return { value, compatibilityMode: "none" };
  }

  const usedKeys = new Set<string>();
  collectPlanKeys(value, usedKeys);
  const actions: unknown[] = [];
  for (const actionValue of value.actions) {
    if (!isRecord(actionValue)) {
      actions.push(actionValue);
      continue;
    }

    switch (actionValue.kind) {
      case "composeText": {
        const normalized = normalizeComposeTextAction(actionValue, usedKeys);
        actions.push(...normalized.actions);
        changed = normalized.changed || changed;
        break;
      }
      case "addCards": {
        const normalized = normalizeCardsAction(actionValue);
        actions.push(...normalized.actions);
        changed = normalized.changed || changed;
        break;
      }
      case "addShapes": {
        const normalized = normalizeShapesAction(actionValue);
        actions.push(...normalized.actions);
        changed = normalized.changed || changed;
        break;
      }
      case "addDiagram":
        actions.push(actionValue);
        changed = normalizeDiagramAction(actionValue) || changed;
        break;
      default:
        actions.push(actionValue);
    }
  }
  value.actions = actions;

  return {
    value,
    compatibilityMode: changed ? COMPATIBILITY_MODE : "none",
  };
}

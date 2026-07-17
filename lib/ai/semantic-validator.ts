import type {
  CanvasCreatableNodeType,
  CanvasNodeType,
  CanvasPatch,
} from "./canvas-patch";

export type PatchRiskClass = "low" | "medium" | "high";

export type SemanticNodeSnapshot = Readonly<{
  id: string;
  type: CanvasNodeType;
  width: number;
  height: number;
  locked?: boolean;
  parentId?: string;
}>;

export type CanvasPatchSemanticContext = Readonly<{
  base: CanvasPatch["base"];
  nodes: readonly SemanticNodeSnapshot[];
  allowedOperations: readonly CanvasPatch["operations"][number]["type"][];
  allowedCreatedNodeTypes?: readonly CanvasCreatableNodeType[];
  protectedNodeIds?: readonly string[];
  limits: Readonly<{
    maxPatchBytes: number;
    maxOperations: number;
    maxAffectedNodes: number;
  }>;
}>;

export type SemanticValidationIssue = Readonly<{
  code:
    | "base_mismatch"
    | "operation_not_allowed"
    | "node_type_not_allowed"
    | "patch_too_large"
    | "too_many_operations"
    | "too_many_affected_nodes"
    | "duplicate_identifier"
    | "forward_reference"
    | "unknown_node"
    | "locked_node"
    | "protected_node"
    | "invalid_parent"
    | "self_reference"
    | "parent_cycle";
  path: string;
  message: string;
}>;

export type CanvasPatchSemanticResult =
  | Readonly<{
      ok: true;
      patchBytes: number;
      affectedNodeIds: readonly string[];
      riskClass: PatchRiskClass;
    }>
  | Readonly<{ ok: false; issues: readonly SemanticValidationIssue[] }>;

const baseFields = [
  "workspaceId",
  "boardId",
  "documentGenerationId",
  "durableSequence",
  "selectionHash",
] as const;

export function validateCanvasPatchSemantics(
  patch: CanvasPatch,
  context: CanvasPatchSemanticContext,
): CanvasPatchSemanticResult {
  const issues: SemanticValidationIssue[] = [];
  const addIssue = (
    code: SemanticValidationIssue["code"],
    path: string,
    message: string,
  ) => issues.push({ code, path, message });

  for (const field of baseFields) {
    if (patch.base[field] !== context.base[field]) {
      addIssue("base_mismatch", `base.${field}`, `Patch base ${field} is stale or invalid`);
    }
  }

  const patchBytes = new TextEncoder().encode(JSON.stringify(patch)).byteLength;
  if (patchBytes > context.limits.maxPatchBytes) {
    addIssue("patch_too_large", "operations", "Patch exceeds the skill byte budget");
  }
  if (patch.operations.length > context.limits.maxOperations) {
    addIssue("too_many_operations", "operations", "Patch exceeds the skill operation budget");
  }

  const existingNodes = new Map(context.nodes.map((node) => [node.id, node]));
  const knownNodes = new Map(context.nodes.map((node) => [node.id, node.type]));
  const createdIdentifiers = new Set<string>();
  const protectedIds = new Set(context.protectedNodeIds ?? []);
  const allowedOperations = new Set(context.allowedOperations);
  const allowedCreatedNodeTypes = context.allowedCreatedNodeTypes
    ? new Set(context.allowedCreatedNodeTypes)
    : undefined;
  const affectedNodeIds = new Set<string>();
  const parentByNode = new Map(
    context.nodes.flatMap((node) => (node.parentId ? [[node.id, node.parentId] as const] : [])),
  );

  patch.operations.forEach((operation, index) => {
    const path = `operations.${index}`;
    if (!allowedOperations.has(operation.type)) {
      addIssue("operation_not_allowed", `${path}.type`, `${operation.type} is not allowed by this skill`);
    }

    if (operation.type === "createNode") {
      if (
        operation.parentId?.startsWith("tmp_") &&
        !existingNodes.has(operation.parentId) &&
        !createdIdentifiers.has(operation.parentId)
      ) {
        addIssue(
          "forward_reference",
          `${path}.parentId`,
          "Temporary references must be created before the sequential canvas operation uses them",
        );
      }
      if (allowedCreatedNodeTypes && !allowedCreatedNodeTypes.has(operation.nodeType)) {
        addIssue(
          "node_type_not_allowed",
          `${path}.nodeType`,
          `${operation.nodeType} nodes are not allowed by this skill`,
        );
      }
      if (existingNodes.has(operation.tempId) || createdIdentifiers.has(operation.tempId)) {
        addIssue("duplicate_identifier", `${path}.tempId`, "Temporary identifier is not unique");
      } else {
        createdIdentifiers.add(operation.tempId);
        knownNodes.set(operation.tempId, operation.nodeType);
      }
      if (operation.parentId) parentByNode.set(operation.tempId, operation.parentId);
      affectedNodeIds.add(operation.tempId);
      return;
    }

    const executionReferences: Array<{ value: string; path: string }> = [];
    if (
      (operation.type === "writeText" ||
        operation.type === "createDrawing") &&
      operation.parentId
    ) {
      executionReferences.push({ value: operation.parentId, path: `${path}.parentId` });
    } else if (operation.type === "createConnector") {
      executionReferences.push(
        { value: operation.sourceId, path: `${path}.sourceId` },
        { value: operation.targetId, path: `${path}.targetId` },
      );
    } else if (
      operation.type === "updateNode" ||
      operation.type === "moveNode" ||
      operation.type === "resizeNode" ||
      operation.type === "deleteNode"
    ) {
      executionReferences.push({ value: operation.nodeId, path: `${path}.nodeId` });
      if (operation.type === "moveNode" && operation.parentId) {
        executionReferences.push({ value: operation.parentId, path: `${path}.parentId` });
      }
    }
    for (const reference of executionReferences) {
      if (
        reference.value.startsWith("tmp_") &&
        !existingNodes.has(reference.value) &&
        !createdIdentifiers.has(reference.value)
      ) {
        addIssue(
          "forward_reference",
          reference.path,
          "Temporary references must be created before the sequential canvas operation uses them",
        );
      }
    }

    if (operation.type === "writeText" || operation.type === "createDrawing") {
      if (existingNodes.has(operation.tempId) || createdIdentifiers.has(operation.tempId)) {
        addIssue("duplicate_identifier", `${path}.tempId`, "Temporary identifier is not unique");
      } else {
        createdIdentifiers.add(operation.tempId);
        knownNodes.set(operation.tempId, "drawing");
      }
      if (operation.parentId) parentByNode.set(operation.tempId, operation.parentId);
      affectedNodeIds.add(operation.tempId);
      return;
    }

    if (operation.type === "createConnector") {
      if (existingNodes.has(operation.tempId) || createdIdentifiers.has(operation.tempId)) {
        addIssue("duplicate_identifier", `${path}.tempId`, "Temporary identifier is not unique");
      } else {
        createdIdentifiers.add(operation.tempId);
      }
      affectedNodeIds.add(operation.sourceId);
      affectedNodeIds.add(operation.targetId);
      return;
    }

    const node = existingNodes.get(operation.nodeId);
    if (!node && !createdIdentifiers.has(operation.nodeId)) {
      addIssue("unknown_node", `${path}.nodeId`, "Operation targets a node outside the authorized snapshot");
    }
    if (node?.locked) {
      addIssue("locked_node", `${path}.nodeId`, "Operation targets a locked node");
    }
    if (protectedIds.has(operation.nodeId)) {
      addIssue("protected_node", `${path}.nodeId`, "Operation targets a protected node");
    }
    if (operation.type === "moveNode") {
      if (operation.parentId === null) parentByNode.delete(operation.nodeId);
      else if (operation.parentId) parentByNode.set(operation.nodeId, operation.parentId);
    }
    if (operation.type === "deleteNode") parentByNode.delete(operation.nodeId);
    affectedNodeIds.add(operation.nodeId);
  });

  patch.operations.forEach((operation, index) => {
    const path = `operations.${index}`;
    const references: Array<{ value: string; path: string; requireFrame?: boolean }> = [];

    if (operation.type === "createNode" && operation.parentId) {
      references.push({ value: operation.parentId, path: `${path}.parentId`, requireFrame: true });
    }
    if (
      (operation.type === "writeText" || operation.type === "createDrawing") &&
      operation.parentId
    ) {
      references.push({ value: operation.parentId, path: `${path}.parentId`, requireFrame: true });
    }
    if (operation.type === "moveNode" && operation.parentId) {
      references.push({ value: operation.parentId, path: `${path}.parentId`, requireFrame: true });
      if (operation.parentId === operation.nodeId) {
        addIssue("self_reference", `${path}.parentId`, "A node cannot parent itself");
      }
    }
    if (operation.type === "createConnector") {
      references.push(
        { value: operation.sourceId, path: `${path}.sourceId` },
        { value: operation.targetId, path: `${path}.targetId` },
      );
      if (operation.sourceId === operation.targetId) {
        addIssue("self_reference", `${path}.targetId`, "A connector cannot connect a node to itself");
      }
    }

    for (const reference of references) {
      const nodeType = knownNodes.get(reference.value);
      if (!nodeType) {
        addIssue("unknown_node", reference.path, "Reference points outside the authorized snapshot or patch");
      } else if (reference.requireFrame && nodeType !== "frame") {
        addIssue("invalid_parent", reference.path, "Parent references must target a frame");
      }
    }
  });

  const visitedParents = new Set<string>();
  const activeParents = new Set<string>();
  const reportedCycles = new Set<string>();
  const visitParent = (nodeId: string) => {
    if (visitedParents.has(nodeId)) return;
    if (activeParents.has(nodeId)) {
      if (!reportedCycles.has(nodeId)) {
        reportedCycles.add(nodeId);
        addIssue("parent_cycle", "operations", "Proposed parent relationships contain a cycle");
      }
      return;
    }
    activeParents.add(nodeId);
    const parentId = parentByNode.get(nodeId);
    if (parentId) visitParent(parentId);
    activeParents.delete(nodeId);
    visitedParents.add(nodeId);
  };
  for (const nodeId of parentByNode.keys()) visitParent(nodeId);

  if (affectedNodeIds.size > context.limits.maxAffectedNodes) {
    addIssue("too_many_affected_nodes", "operations", "Patch exceeds the affected-node budget");
  }

  if (issues.length > 0) return { ok: false, issues };

  const hasDeletion = patch.operations.some((operation) => operation.type === "deleteNode");
  const riskClass: PatchRiskClass = hasDeletion
    ? "high"
    : patch.operations.length > 20 ||
        patch.operations.some((operation) => operation.type === "resizeNode")
      ? "medium"
      : "low";

  return {
    ok: true,
    patchBytes,
    affectedNodeIds: [...affectedNodeIds].sort(),
    riskClass,
  };
}

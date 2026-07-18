import type { CanvasPatch } from "./canvas-patch";

const TEMPORARY_IDENTIFIER = /^tmp_[A-Za-z0-9_-]{1,60}$/;

/**
 * Returns true only when a patch can be added to a newer board revision
 * without reading from or mutating any pre-existing canvas object.
 *
 * References must point backward to nodes created earlier in this same patch.
 * This keeps concurrent application atomic and prevents a stale proposal from
 * attaching to, moving, or otherwise depending on a changed board object.
 */
export function isSelfContainedAdditivePatch(patch: CanvasPatch): boolean {
  if (patch.operations.length === 0) return false;

  const createdIdentifiers = new Set<string>();
  const createdNodeIdentifiers = new Set<string>();

  for (const operation of patch.operations) {
    if (
      operation.type === "createNode" ||
      operation.type === "writeText" ||
      operation.type === "createDrawing"
    ) {
      if (
        !TEMPORARY_IDENTIFIER.test(operation.tempId) ||
        createdIdentifiers.has(operation.tempId) ||
        (operation.parentId !== undefined &&
          !createdNodeIdentifiers.has(operation.parentId))
      ) {
        return false;
      }

      createdIdentifiers.add(operation.tempId);
      createdNodeIdentifiers.add(operation.tempId);
      continue;
    }

    if (operation.type === "createConnector") {
      if (
        !TEMPORARY_IDENTIFIER.test(operation.tempId) ||
        createdIdentifiers.has(operation.tempId) ||
        !createdNodeIdentifiers.has(operation.sourceId) ||
        !createdNodeIdentifiers.has(operation.targetId)
      ) {
        return false;
      }

      createdIdentifiers.add(operation.tempId);
      continue;
    }

    return false;
  }

  return true;
}

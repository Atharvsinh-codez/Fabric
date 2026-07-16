import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  InvalidPaginationCursorError,
  decodeActivityCursor,
  decodeBoardListCursor,
  encodeActivityCursor,
  encodeBoardListCursor,
  paginationScope,
} from "./pagination";

const boardId = "11111111-1111-4111-8111-111111111111";
const commentId = "22222222-2222-4222-8222-222222222222";
const at = "2026-07-15T12:34:56.789123Z";

describe("opaque pagination cursors", () => {
  it("round-trips the complete board ordering tuple", () => {
    const scope = paginationScope(["boards", "workspace", "recent"]);
    const encoded = encodeBoardListCursor(
      { pinned: true, sortAt: at, id: boardId },
      scope,
    );

    expect(encoded).not.toContain(boardId);
    expect(decodeBoardListCursor(encoded, scope)).toEqual({
      pinned: true,
      sortAt: at,
      id: boardId,
    });
  });

  it("binds cursors to their exact query scope", () => {
    const encoded = encodeBoardListCursor(
      { pinned: false, sortAt: at, id: boardId },
      paginationScope(["boards", "workspace-a", "recent"]),
    );

    expect(() =>
      decodeBoardListCursor(
        encoded,
        paginationScope(["boards", "workspace-b", "recent"]),
      ),
    ).toThrow(InvalidPaginationCursorError);
  });

  it("retains timestamp and unique identity for activity ties", () => {
    const scope = paginationScope(["activity", "workspace"]);
    const id = `comment:${commentId}`;
    const encoded = encodeActivityCursor({ occurredAt: at, id }, scope);

    expect(decodeActivityCursor(encoded, scope)).toEqual({
      occurredAt: at,
      id,
    });
    expect(() =>
      decodeActivityCursor(`${encoded}x`, scope),
    ).toThrow(InvalidPaginationCursorError);
  });
});

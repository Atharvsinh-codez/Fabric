import { describe, expect, it } from "vitest";

import { boardActivityPath, memberActivityPath } from "./activity-links";

describe("workspace activity links", () => {
  it("targets the canonical board editor", () => {
    expect(boardActivityPath("board/id")).toBe("/app/boards/board%2Fid");
  });

  it("targets canonical member management with workspace scope", () => {
    expect(memberActivityPath("workspace/id")).toBe(
      "/app/dashboard/members?workspaceId=workspace%2Fid",
    );
  });
});

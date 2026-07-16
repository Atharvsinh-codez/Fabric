import { describe, expect, it } from "vitest";

import { checkpointCapability, type BoardCheckpointAction } from "./checkpoint-policy";
import { roleCan } from "./permissions";

describe("board checkpoint authorization policy", () => {
  it("allows every workspace member to list checkpoint metadata", () => {
    const capability = checkpointCapability("list");
    expect(roleCan("owner", capability)).toBe(true);
    expect(roleCan("editor", capability)).toBe(true);
    expect(roleCan("commenter", capability)).toBe(true);
    expect(roleCan("viewer", capability)).toBe(true);
  });

  it.each<BoardCheckpointAction>(["create", "restore"])(
    "limits %s to owners and editors",
    (action) => {
      const capability = checkpointCapability(action);
      expect(roleCan("owner", capability)).toBe(true);
      expect(roleCan("editor", capability)).toBe(true);
      expect(roleCan("commenter", capability)).toBe(false);
      expect(roleCan("viewer", capability)).toBe(false);
    },
  );
});

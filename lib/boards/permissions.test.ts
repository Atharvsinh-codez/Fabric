import { describe, expect, it } from "vitest";

import { roleCan } from "./permissions";

describe("workspace role capabilities", () => {
  it("keeps viewer and commenter permissions narrow", () => {
    expect(roleCan("viewer", "view")).toBe(true);
    expect(roleCan("viewer", "comment")).toBe(false);
    expect(roleCan("commenter", "comment")).toBe(true);
    expect(roleCan("commenter", "edit_board")).toBe(false);
  });

  it("reserves membership and share management for owners", () => {
    expect(roleCan("owner", "manage_members")).toBe(true);
    expect(roleCan("owner", "manage_sharing")).toBe(true);
    expect(roleCan("owner", "delete_workspace")).toBe(true);
    expect(roleCan("editor", "manage_members")).toBe(false);
    expect(roleCan("editor", "manage_sharing")).toBe(false);
    expect(roleCan("editor", "delete_workspace")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  avatarFinalObjectKey,
  avatarUploadObjectKey,
  boardAssetFinalObjectKey,
  boardAssetUploadObjectKey,
} from "./object-keys";

describe("private R2 object keys", () => {
  it("keeps board staging and immutable final objects in disjoint prefixes", () => {
    expect(boardAssetUploadObjectKey("board", "upload")).toBe(
      "boards/board/uploads/upload",
    );
    expect(boardAssetFinalObjectKey("board", "storage", "hash")).toBe(
      "boards/board/assets/storage/hash",
    );
  });

  it("keeps avatar staging and deterministic final objects in disjoint prefixes", () => {
    expect(avatarUploadObjectKey("user", "upload")).toBe(
      "avatars/user/uploads/upload",
    );
    expect(avatarFinalObjectKey("user", "upload")).toBe(
      "avatars/user/assets/upload",
    );
  });
});

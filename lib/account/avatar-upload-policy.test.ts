import { describe, expect, it } from "vitest";

import {
  AVATAR_MAX_OUTSTANDING_UPLOADS,
  avatarUploadCapacityAvailable,
  sameAvatarUploadIntent,
} from "./avatar-upload-policy";

const intent = {
  userId: "11111111-1111-4111-8111-111111111111",
  mimeType: "image/png" as const,
  byteSize: 8,
  contentHash: "a".repeat(64),
  r2ObjectKey:
    "avatars/11111111-1111-4111-8111-111111111111/uploads/22222222-2222-4222-8222-222222222222",
};

describe("avatar upload reservation policy", () => {
  it("keeps a generous but strict outstanding-grant bound", () => {
    expect(AVATAR_MAX_OUTSTANDING_UPLOADS).toBe(12);
    expect(
      avatarUploadCapacityAvailable(AVATAR_MAX_OUTSTANDING_UPLOADS - 1),
    ).toBe(true);
    expect(
      avatarUploadCapacityAvailable(AVATAR_MAX_OUTSTANDING_UPLOADS),
    ).toBe(false);
    expect(avatarUploadCapacityAvailable(-1)).toBe(false);
  });

  it("treats only an exact repeated intent as idempotent", () => {
    expect(sameAvatarUploadIntent(intent, { ...intent })).toBe(true);
    expect(
      sameAvatarUploadIntent(intent, { ...intent, byteSize: intent.byteSize + 1 }),
    ).toBe(false);
    expect(
      sameAvatarUploadIntent(intent, {
        ...intent,
        contentHash: "b".repeat(64),
      }),
    ).toBe(false);
  });
});

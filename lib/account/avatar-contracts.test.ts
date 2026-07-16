import { describe, expect, it } from "vitest";

import {
  AVATAR_MAX_BYTES,
  AvatarUploadInitSchema,
  resolveUserAvatar,
} from "./avatar-contracts";

describe("resolveUserAvatar", () => {
  it("uses custom override, then OAuth, then initials", () => {
    expect(resolveUserAvatar({
      id: "11111111-1111-4111-8111-111111111111",
      image: "https://oauth.example/avatar.png",
      avatarObjectKey: "avatars/user/ready",
      avatarContentHash: "a".repeat(64),
    })).toEqual({
      image: `/api/users/11111111-1111-4111-8111-111111111111/avatar?v=${"a".repeat(64)}`,
      source: "custom",
    });
    expect(resolveUserAvatar({ id: "user", image: "https://oauth.example/avatar.png" })).toEqual({
      image: "https://oauth.example/avatar.png",
      source: "oauth",
    });
    expect(resolveUserAvatar({ id: "user", image: "data:image/png;base64,abc" })).toEqual({
      image: null,
      source: "initials",
    });
  });
});

describe("AvatarUploadInitSchema", () => {
  it("requires a client idempotency UUID and rejects oversized intent", () => {
    const base = {
      requestId: "22222222-2222-4222-8222-222222222222",
      mimeType: "image/png",
      byteSize: 8,
      contentHash: "a".repeat(64),
    };
    expect(AvatarUploadInitSchema.safeParse(base).success).toBe(true);
    expect(
      AvatarUploadInitSchema.safeParse({
        ...base,
        byteSize: AVATAR_MAX_BYTES + 1,
      }).success,
    ).toBe(false);
    expect(
      AvatarUploadInitSchema.safeParse({
        ...base,
        requestId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

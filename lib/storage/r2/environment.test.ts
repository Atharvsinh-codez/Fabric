import { describe, expect, it } from "vitest";

import { parseR2Environment } from "./environment";

const validEnvironment = {
  FABRIC_R2_ACCOUNT_ID: "a".repeat(32),
  FABRIC_R2_ACCESS_KEY_ID: "A".repeat(20),
  FABRIC_R2_SECRET_ACCESS_KEY: "s".repeat(40),
  FABRIC_R2_BOARD_ASSET_BUCKET: "fabric-board-assets",
  FABRIC_R2_AVATAR_BUCKET: "fabric-avatars",
  FABRIC_R2_PRESIGN_TTL_SECONDS: "300",
};

describe("parseR2Environment", () => {
  it("maps private, purpose-specific R2 configuration", () => {
    expect(parseR2Environment(validEnvironment)).toEqual({
      accountId: "a".repeat(32),
      accessKeyId: "A".repeat(20),
      secretAccessKey: "s".repeat(40),
      boardAssetBucket: "fabric-board-assets",
      avatarBucket: "fabric-avatars",
      presignTtlSeconds: 300,
    });
  });

  it("rejects missing credentials and long-lived upload grants", () => {
    expect(() => parseR2Environment({ ...validEnvironment, FABRIC_R2_SECRET_ACCESS_KEY: "" })).toThrow();
    expect(() => parseR2Environment({ ...validEnvironment, FABRIC_R2_PRESIGN_TTL_SECONDS: "3600" })).toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";

vi.mock("server-only", () => ({}));

import { R2PrivateObjectStore } from "./private-object-store";

describe("R2PrivateObjectStore", () => {
  it("presigns a write-once exact key with bound content and no SDK checksum extension", async () => {
    const store = new R2PrivateObjectStore({
      accountId: "a".repeat(32),
      accessKeyId: "A".repeat(20),
      secretAccessKey: "s".repeat(40),
      boardAssetBucket: "fabric-board-assets",
      avatarBucket: "fabric-avatars",
      presignTtlSeconds: 300,
    });
    const grant = await store.createUpload({
      bucket: "board-assets",
      key: "boards/11111111-1111-4111-8111-111111111111/uploads/22222222-2222-4222-8222-222222222222",
      contentType: "video/webm",
      byteSize: 42,
      metadata: {
        "fabric-content-sha256": "b".repeat(64),
        "fabric-byte-size": "42",
      },
      now: new Date("2026-01-02T03:04:05.000Z"),
    });

    const url = new URL(grant.url);
    expect(url.hostname).toBe(
      `fabric-board-assets.${"a".repeat(32)}.r2.cloudflarestorage.com`,
    );
    expect(url.pathname).toContain("/boards/11111111-1111-4111-8111-111111111111/uploads/");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host;if-none-match;x-amz-meta-fabric-byte-size;x-amz-meta-fabric-content-sha256",
    );
    expect(url.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
    expect(grant.url).not.toContain("s".repeat(40));
    expect(grant.headers).toEqual({
      "content-type": "video/webm",
      "if-none-match": "*",
      "x-amz-meta-fabric-content-sha256": "b".repeat(64),
      "x-amz-meta-fabric-byte-size": "42",
    });
    expect(grant.headers).not.toHaveProperty("content-length");
  });

  it("rejects an invalid declared size before issuing a grant", async () => {
    const store = new R2PrivateObjectStore({
      accountId: "a".repeat(32),
      accessKeyId: "A".repeat(20),
      secretAccessKey: "s".repeat(40),
      boardAssetBucket: "fabric-board-assets",
      avatarBucket: "fabric-avatars",
      presignTtlSeconds: 300,
    });

    await expect(
      store.createUpload({
        bucket: "avatars",
        key: "avatars/one/uploads/two",
        contentType: "image/png",
        byteSize: 0,
        metadata: {},
      }),
    ).rejects.toThrow("exact positive byte size");
  });

  it("never signs beyond a durable reservation expiry", async () => {
    const store = new R2PrivateObjectStore({
      accountId: "a".repeat(32),
      accessKeyId: "A".repeat(20),
      secretAccessKey: "s".repeat(40),
      boardAssetBucket: "fabric-board-assets",
      avatarBucket: "fabric-avatars",
      presignTtlSeconds: 300,
    });
    const now = new Date("2026-01-02T03:04:05.000Z");
    const grant = await store.createUpload({
      bucket: "avatars",
      key: "avatars/one/uploads/two",
      contentType: "image/png",
      byteSize: 8,
      metadata: {},
      now,
      expiresAt: new Date(now.getTime() + 30_000),
    });

    expect(new URL(grant.url).searchParams.get("X-Amz-Expires")).toBe("30");
    expect(grant.expiresAt).toBe("2026-01-02T03:04:35.000Z");
  });

  it("conditionally copies staging to a separate server-only final key", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ETag: '"ready-etag"', VersionId: "ready-version" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ETag: '"ready-etag"', VersionId: "ready-version" });
    const store = new R2PrivateObjectStore(
      {
        accountId: "a".repeat(32),
        accessKeyId: "A".repeat(20),
        secretAccessKey: "s".repeat(40),
        boardAssetBucket: "fabric-board-assets",
        avatarBucket: "fabric-avatars",
        presignTtlSeconds: 300,
      },
      { send } as unknown as S3Client,
    );
    await expect(
      store.promote({
        bucket: "board-assets",
        sourceKey: "boards/one/uploads/two",
        destinationKey: `boards/one/assets/three/${"b".repeat(64)}`,
        sourceEtag: "staging-etag",
      }),
    ).resolves.toEqual({ etag: "ready-etag", version: "ready-version" });

    await expect(
      store.promote({
        bucket: "board-assets",
        sourceKey: "boards/one/uploads/two",
        destinationKey: `boards/one/assets/three/${"b".repeat(64)}`,
        sourceEtag: "staging-etag",
      }),
    ).resolves.toEqual({ etag: "ready-etag", version: "ready-version" });

    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: "fabric-board-assets",
      Key: `boards/one/assets/three/${"b".repeat(64)}`,
      CopySource: "fabric-board-assets/boards/one/uploads/two",
      CopySourceIfMatch: '"staging-etag"',
      MetadataDirective: "COPY",
    });
    expect(send.mock.calls[1]?.[0].input).toEqual({
      Bucket: "fabric-board-assets",
      Key: `boards/one/assets/three/${"b".repeat(64)}`,
    });
    expect(send.mock.calls[2]?.[0].input).toEqual(send.mock.calls[0]?.[0].input);
  });
});

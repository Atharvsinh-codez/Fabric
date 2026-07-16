import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./r2-repository", () => ({ boardAssetR2Repository: {} }));

import type { BoardAssetR2Repository } from "./r2-repository";
import {
  finalizeBoardAssetUpload,
  initiateBoardAssetUpload,
} from "./r2-upload-service";
import type { PrivateObjectStore } from "@/lib/storage/r2/private-object-store";

const boardId = "11111111-1111-4111-8111-111111111111";
const uploadId = "22222222-2222-4222-8222-222222222222";
const storageId = "33333333-3333-4333-8333-333333333333";
const hash = "a".repeat(64);
const expiresAt = new Date("2026-01-02T03:09:05.000Z");
const pending = {
  uploadId,
  storageId,
  boardId,
  tldrawAssetId: "asset:test",
  mimeType: "image/png" as const,
  originalName: "hero.png",
  byteSize: 8,
  contentHash: hash,
  r2ObjectKey: `boards/${boardId}/uploads/${uploadId}`,
  uploadExpiresAt: expiresAt,
};

function repository(): BoardAssetR2Repository {
  return {
    reserve: vi.fn(async () => pending),
    getPending: vi.fn(async () => pending),
    getFinalized: vi.fn(async () => null),
    finalize: vi.fn(async () => ({
      id: storageId,
      boardId,
      tldrawAssetId: "asset:test",
      mimeType: "image/png" as const,
      byteSize: 8,
      contentHash: hash,
    })),
    reject: vi.fn(async () => undefined),
  };
}

function objectStore(): PrivateObjectStore {
  return {
    createUpload: vi.fn(async () => ({
      url: "https://r2.example/exact-key?signed=yes",
      method: "PUT" as const,
      headers: { "content-type": "image/png", "if-none-match": "*" },
      expiresAt: expiresAt.toISOString(),
    })),
    inspect: vi.fn(async () => ({
      byteSize: 8,
      contentType: "image/png",
      contentHash: hash,
      firstBytes: new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]),
      metadata: {
        "fabric-content-sha256": hash,
        "fabric-byte-size": "8",
        "fabric-media-type": "image/png",
        "fabric-upload-kind": "board-asset",
      },
      etag: "etag",
      version: "version",
    })),
    promote: vi.fn(async () => ({
      etag: "promoted-etag",
      version: "promoted-version",
    })),
    get: vi.fn(async () => {
      throw new Error("unused");
    }),
    delete: vi.fn(async () => undefined),
  };
}

describe("board R2 upload service", () => {
  it("reserves only the exact presigned object metadata", async () => {
    const repo = repository();
    const store = objectStore();
    const result = await initiateBoardAssetUpload(
      {
        userId: "user-id",
        boardId,
        tldrawAssetId: "asset:test",
        mimeType: "image/png",
        originalName: "hero.png",
        byteSize: 8,
        contentHash: hash,
      },
      {
        repository: repo,
        objectStore: store,
        now: () => new Date("2026-01-02T03:04:05Z"),
        uuid: () => uploadId,
      },
    );
    expect(result.upload.url).toContain("signed=yes");
    expect(store.createUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        key: pending.r2ObjectKey,
        contentType: "image/png",
        byteSize: 8,
        metadata: expect.objectContaining({
          "fabric-content-sha256": hash,
          "fabric-byte-size": "8",
        }),
      }),
    );
    expect(repo.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId }),
    );
  });

  it("promotes staging to a browser-unwritable final key before exposing the stable URL", async () => {
    const repo = repository();
    const store = objectStore();
    const result = await finalizeBoardAssetUpload(
      { userId: "user-id", boardId, uploadId },
      {
        repository: repo,
        objectStore: store,
        now: () => new Date("2026-01-02T03:05:05Z"),
        uuid: () => uploadId,
      },
    );
    expect(result.asset.src).toBe(`/api/boards/${boardId}/assets/${storageId}`);
    expect(result.asset.src).not.toContain("r2");
    const finalKey = `boards/${boardId}/assets/${storageId}/${hash}`;
    expect(store.promote).toHaveBeenCalledWith({
      bucket: "board-assets",
      sourceKey: pending.r2ObjectKey,
      destinationKey: finalKey,
      sourceEtag: "etag",
    });
    expect(finalKey).not.toBe(pending.r2ObjectKey);
    expect(repo.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId,
        r2ObjectKey: finalKey,
        r2Etag: "promoted-etag",
        r2Version: "promoted-version",
      }),
    );
  });

  it("retains the immutable promoted object when the database outcome is ambiguous", async () => {
    const repo = repository();
    vi.mocked(repo.finalize).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const store = objectStore();
    const finalKey = `boards/${boardId}/assets/${storageId}/${hash}`;

    await expect(
      finalizeBoardAssetUpload(
        { userId: "user-id", boardId, uploadId },
        {
          repository: repo,
          objectStore: store,
          now: () => new Date("2026-01-02T03:05:05Z"),
          uuid: () => uploadId,
        },
      ),
    ).rejects.toThrow("database unavailable");
    expect(store.delete).not.toHaveBeenCalledWith({
      bucket: "board-assets",
      key: finalKey,
    });
    expect(store.delete).not.toHaveBeenCalledWith({
      bucket: "board-assets",
      key: pending.r2ObjectKey,
    });
  });

  it("returns the committed stable asset when finalize is retried after response loss", async () => {
    const repo = repository();
    vi.mocked(repo.getFinalized).mockResolvedValueOnce({
      id: storageId,
      boardId,
      tldrawAssetId: "asset:test",
      mimeType: "image/png",
      byteSize: 8,
      contentHash: hash,
    });
    const store = objectStore();

    await expect(
      finalizeBoardAssetUpload(
        { userId: "user-id", boardId, uploadId },
        {
          repository: repo,
          objectStore: store,
          now: () => new Date("2026-01-02T03:05:05Z"),
          uuid: () => uploadId,
        },
      ),
    ).resolves.toEqual({
      asset: {
        id: storageId,
        tldrawAssetId: "asset:test",
        src: `/api/boards/${boardId}/assets/${storageId}`,
        mimeType: "image/png",
        byteSize: 8,
        contentHash: hash,
      },
    });
    expect(repo.getPending).not.toHaveBeenCalled();
    expect(store.inspect).not.toHaveBeenCalled();
    expect(store.promote).not.toHaveBeenCalled();
  });
});

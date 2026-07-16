import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./avatar-repository", () => ({ avatarRepository: {} }));

import type { AvatarRepository } from "./avatar-repository";
import { finalizeAvatarUpload, initiateAvatarUpload } from "./avatar-service";
import type { PrivateObjectStore } from "@/lib/storage/r2/private-object-store";

const userId = "11111111-1111-4111-8111-111111111111";
const uploadId = "22222222-2222-4222-8222-222222222222";
const hash = "a".repeat(64);
const expiresAt = new Date("2026-07-15T10:05:00.000Z");
const reservation = {
  id: uploadId,
  userId,
  mimeType: "image/png" as const,
  byteSize: 8,
  contentHash: hash,
  r2ObjectKey: `avatars/${userId}/uploads/${uploadId}`,
  status: "pending" as const,
  expiresAt,
};

describe("finalizeAvatarUpload", () => {
  it("reuses a client-keyed reservation and signs its exact byte size", async () => {
    const reserveUpload = vi.fn(async () => reservation);
    const repository = { reserveUpload } as unknown as AvatarRepository;
    const objectStore = {
      createUpload: vi.fn(async () => ({
        method: "PUT" as const,
        url: "https://r2.example/staging?signed=yes",
        headers: { "content-type": "image/png", "if-none-match": "*" },
        expiresAt: "2026-07-15T10:05:00.000Z",
      })),
    } as unknown as PrivateObjectStore;
    const dependencies = {
      repository,
      objectStore,
      now: () => new Date("2026-07-15T10:00:00.000Z"),
    };
    const input = {
      userId,
      requestId: uploadId,
      mimeType: "image/png" as const,
      byteSize: 8,
      contentHash: hash,
    };

    const first = await initiateAvatarUpload(input, dependencies);
    const retry = await initiateAvatarUpload(input, dependencies);

    expect(first.upload.id).toBe(uploadId);
    expect(retry.upload.id).toBe(uploadId);
    expect(reserveUpload).toHaveBeenCalledTimes(2);
    expect(reserveUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId,
        r2ObjectKey: reservation.r2ObjectKey,
        byteSize: 8,
      }),
    );
    expect(objectStore.createUpload).toHaveBeenCalledWith({
      bucket: "avatars",
      key: reservation.r2ObjectKey,
      contentType: "image/png",
      byteSize: 8,
      metadata: expect.objectContaining({
        "fabric-content-sha256": hash,
        "fabric-byte-size": "8",
        "fabric-expires-at": expiresAt.toISOString(),
      }),
      now: new Date("2026-07-15T10:00:00.000Z"),
      expiresAt,
    });
  });

  it("retains a failed promotion swap and safely retries from staging", async () => {
    const stagingKey = `avatars/${userId}/uploads/${uploadId}`;
    const finalKey = `avatars/${userId}/assets/${uploadId}`;
    const replacement = {
      user: {
        id: userId,
        image: "https://oauth.example/avatar.png",
        avatarObjectKey: finalKey,
        avatarContentHash: hash,
      },
      previousObjectKey: null,
    };
    const replace = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(replacement);
    const get = vi.fn(async () => ({
      id: userId,
      image: "https://oauth.example/avatar.png",
      avatarObjectKey: null,
      avatarContentHash: null,
    }));
    const repository = {
      get,
      getUpload: vi.fn(async () => reservation),
      replace,
      rejectUpload: vi.fn(),
      clear: vi.fn(),
    } as unknown as AvatarRepository;
    const promote = vi.fn(async () => ({
      etag: "ready-etag",
      version: "ready-version",
    }));
    const remove = vi.fn(async () => undefined);
    const objectStore = {
      inspect: vi.fn(async () => ({
        byteSize: 8,
        contentType: "image/png",
        contentHash: hash,
        firstBytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
        metadata: {
          "fabric-owner-id": userId,
          "fabric-content-sha256": hash,
          "fabric-byte-size": "8",
          "fabric-media-type": "image/png",
          "fabric-upload-kind": "avatar",
          "fabric-expires-at": "2026-07-15T10:05:00.000Z",
        },
        etag: "staging-etag",
        version: "staging-version",
      })),
      promote,
      delete: remove,
    } as unknown as PrivateObjectStore;

    const dependencies = {
      repository,
      objectStore,
      now: () => new Date("2026-07-15T10:01:00.000Z"),
    };
    await expect(
      finalizeAvatarUpload({ userId, uploadId }, dependencies),
    ).rejects.toThrow("database unavailable");
    expect(remove).not.toHaveBeenCalledWith({
      bucket: "avatars",
      key: finalKey,
    });
    expect(remove).not.toHaveBeenCalledWith({
      bucket: "avatars",
      key: stagingKey,
    });
    remove.mockClear();

    const result = await finalizeAvatarUpload(
      { userId, uploadId },
      dependencies,
    );

    expect(promote).toHaveBeenCalledWith({
      bucket: "avatars",
      sourceKey: stagingKey,
      destinationKey: finalKey,
      sourceEtag: "staging-etag",
    });
    expect(finalKey).not.toBe(stagingKey);
    expect(promote).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId,
        stagingObjectKey: stagingKey,
        avatarObjectKey: finalKey,
        avatarR2Etag: "ready-etag",
        avatarR2Version: "ready-version",
      }),
    );
    expect(remove).toHaveBeenCalledWith({ bucket: "avatars", key: stagingKey });
    expect(result.avatar.image).toBe(`/api/users/${userId}/avatar?v=${hash}`);
  });

  it("returns the committed avatar when finalize is retried after response loss", async () => {
    const finalKey = `avatars/${userId}/assets/${uploadId}`;
    const repository = {
      get: vi.fn(async () => ({
        id: userId,
        image: "https://oauth.example/avatar.png",
        avatarObjectKey: finalKey,
        avatarContentHash: hash,
      })),
    } as unknown as AvatarRepository;
    const objectStore = {
      inspect: vi.fn(),
      promote: vi.fn(),
      delete: vi.fn(),
    } as unknown as PrivateObjectStore;

    await expect(
      finalizeAvatarUpload(
        { userId, uploadId },
        {
          repository,
          objectStore,
          now: () => new Date("2026-07-15T10:01:00.000Z"),
        },
      ),
    ).resolves.toEqual({
      avatar: {
        image: `/api/users/${userId}/avatar?v=${hash}`,
        source: "custom",
      },
    });
    expect(objectStore.inspect).not.toHaveBeenCalled();
    expect(objectStore.promote).not.toHaveBeenCalled();
  });

  it("rejects and schedules cleanup when uploaded bytes differ from the reservation", async () => {
    const rejectUpload = vi.fn(async () => undefined);
    const repository = {
      get: vi.fn(async () => ({
        id: userId,
        avatarObjectKey: null,
        avatarContentHash: null,
      })),
      getUpload: vi.fn(async () => reservation),
      rejectUpload,
    } as unknown as AvatarRepository;
    const remove = vi.fn(async () => undefined);
    const objectStore = {
      inspect: vi.fn(async () => ({
        byteSize: 7,
        contentType: "image/png",
        contentHash: hash,
        firstBytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
        metadata: {
          "fabric-owner-id": userId,
          "fabric-content-sha256": hash,
          "fabric-byte-size": "7",
          "fabric-media-type": "image/png",
          "fabric-upload-kind": "avatar",
          "fabric-expires-at": expiresAt.toISOString(),
        },
        etag: "staging-etag",
        version: null,
      })),
      delete: remove,
    } as unknown as PrivateObjectStore;

    await expect(
      finalizeAvatarUpload(
        { userId, uploadId },
        {
          repository,
          objectStore,
          now: () => new Date("2026-07-15T10:01:00.000Z"),
        },
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "avatar_verification_failed",
    });
    expect(remove).toHaveBeenCalledWith({
      bucket: "avatars",
      key: reservation.r2ObjectKey,
    });
    expect(rejectUpload).toHaveBeenCalledWith({
      userId,
      uploadId,
      now: new Date("2026-07-15T10:01:00.000Z"),
    });
  });
});

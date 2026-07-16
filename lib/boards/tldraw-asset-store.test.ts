import type { TLAsset, TLAssetId } from "tldraw";
import { describe, expect, it, vi } from "vitest";

import {
  createFabricTldrawAssetStore,
  storageIdFromBoardAssetSource,
} from "./tldraw-asset-store";

const boardId = "11111111-1111-4111-8111-111111111111";
const storageId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";

function imageAsset(source = "") {
  return {
    id: "asset:test",
    typeName: "asset",
    type: "image",
    props: { src: source },
    meta: {},
  } as unknown as TLAsset;
}

describe("createFabricTldrawAssetStore", () => {
  it("uses init, exact-header direct PUT, and finalize without persisting the signed URL", async () => {
    const fetchRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === `/api/boards/${boardId}/assets/uploads`) {
        return Response.json({
          upload: {
            id: uploadId,
            method: "PUT",
            url: "https://private-r2.example/upload?signature=secret",
            headers: {
              "content-type": "image/png",
              "if-none-match": "*",
              "x-amz-meta-fabric-content-sha256": "server-bound-hash",
            },
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        }, { status: 201 });
      }
      if (String(input).startsWith("https://private-r2.example/")) {
        return new Response(null, { status: 200 });
      }
      expect(String(input)).toBe(
        `/api/boards/${boardId}/assets/uploads/${uploadId}/finalize`,
      );
      expect(init?.method).toBe("POST");
      return Response.json({
        asset: {
          id: storageId,
          src: `/api/boards/${boardId}/assets/${storageId}`,
          mimeType: "image/png",
          byteSize: 8,
          contentHash: "a".repeat(64),
        },
      }, { status: 201 });
    });
    const store = createFabricTldrawAssetStore({
      boardId,
      fetch: fetchRequest as unknown as typeof fetch,
    });
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "hero.png",
      { type: "image/png" },
    );

    await expect(store.upload(imageAsset(), file)).resolves.toEqual({
      src: `/api/boards/${boardId}/assets/${storageId}`,
      meta: {
        fabricStorageId: storageId,
        fabricContentHash: "a".repeat(64),
      },
    });
    expect(fetchRequest).toHaveBeenCalledTimes(3);
    expect(fetchRequest).toHaveBeenNthCalledWith(
      1,
      `/api/boards/${boardId}/assets/uploads`,
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(JSON.parse(fetchRequest.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      assetId: "asset:test",
      mimeType: "image/png",
      byteSize: 8,
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(fetchRequest).toHaveBeenNthCalledWith(
      2,
      "https://private-r2.example/upload?signature=secret",
      expect.objectContaining({
        method: "PUT",
        credentials: "omit",
        body: file,
        headers: {
          "content-type": "image/png",
          "if-none-match": "*",
          "x-amz-meta-fabric-content-sha256": "server-bound-hash",
        },
      }),
    );
  });

  it("keeps legacy image editing available while the workspace rollout is off", async () => {
    const fetchRequest = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          `/api/boards/${boardId}/assets?assetId=asset%3Atest`,
        );
        expect(init).toMatchObject({
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "image/png",
            "x-fabric-asset-name": "legacy%20hero.png",
          },
        });
        return Response.json(
          {
            asset: {
              id: storageId,
              src: `/api/boards/${boardId}/assets/${storageId}`,
              mimeType: "image/png",
              byteSize: 8,
              contentHash: "b".repeat(64),
            },
          },
          { status: 201 },
        );
      },
    );
    const store = createFabricTldrawAssetStore({
      boardId,
      r2UploadsEnabled: false,
      fetch: fetchRequest as unknown as typeof fetch,
    });
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "legacy hero.png",
      { type: "image/png" },
    );

    await expect(store.upload(imageAsset(), file)).resolves.toEqual({
      src: `/api/boards/${boardId}/assets/${storageId}`,
      meta: {
        fabricStorageId: storageId,
        fabricContentHash: "b".repeat(64),
      },
    });
    expect(fetchRequest).toHaveBeenCalledOnce();
  });

  it("does not start the R2 video flow while the workspace rollout is off", async () => {
    const fetchRequest = vi.fn();
    const store = createFabricTldrawAssetStore({
      boardId,
      r2UploadsEnabled: false,
      fetch: fetchRequest as unknown as typeof fetch,
    });
    const video = new File([new Uint8Array([0, 0, 0, 0])], "clip.mp4", {
      type: "video/mp4",
    });

    await expect(store.upload(imageAsset(), video)).rejects.toThrow(
      "Video uploads are not available in this workspace yet.",
    );
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("rewrites member sources for a public share without persisting its bearer token", () => {
    const token = "A".repeat(43);
    const memberSource = `/api/boards/${boardId}/assets/${storageId}`;
    const store = createFabricTldrawAssetStore({
      boardId,
      access: { kind: "share", token },
      fetch: vi.fn() as unknown as typeof fetch,
    });

    expect(store.resolve?.(imageAsset(memberSource), {} as never)).toBe(
      `/api/shares/${token}/assets/${storageId}`,
    );
    expect(store.resolve?.(imageAsset("https://images.example/hero.png"), {} as never)).toBe(
      "https://images.example/hero.png",
    );
  });

  it("chunks idempotent deletion requests to the server limit", async () => {
    const fetchRequest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ deletedCount: 1 });
    });
    const store = createFabricTldrawAssetStore({
      boardId,
      fetch: fetchRequest as unknown as typeof fetch,
    });
    const ids = Array.from({ length: 101 }, (_, index) => `asset:${index}` as TLAssetId);

    await store.remove?.(ids);
    expect(fetchRequest).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchRequest.mock.calls[0]?.[1]?.body as string).assetIds).toHaveLength(100);
    expect(JSON.parse(fetchRequest.mock.calls[1]?.[1]?.body as string).assetIds).toHaveLength(1);
  });

  it("keeps baseline asset deletion available while rollout is off", async () => {
    const fetchRequest = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({ deletedCount: 1 });
      },
    );
    const store = createFabricTldrawAssetStore({
      boardId,
      r2UploadsEnabled: false,
      fetch: fetchRequest as unknown as typeof fetch,
    });

    await store.remove?.(["asset:legacy" as TLAssetId]);
    expect(fetchRequest).toHaveBeenCalledOnce();
    expect(fetchRequest.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });
});

describe("storageIdFromBoardAssetSource", () => {
  it("accepts only a UUID in the exact board asset path", () => {
    expect(
      storageIdFromBoardAssetSource(`/api/boards/${boardId}/assets/${storageId}`, boardId),
    ).toBe(storageId);
    expect(storageIdFromBoardAssetSource(`/api/boards/${boardId}/assets/not-a-uuid`, boardId)).toBeNull();
    expect(storageIdFromBoardAssetSource(`/api/boards/another/assets/${storageId}`, boardId)).toBeNull();
  });
});

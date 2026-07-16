import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PrivateObjectStore } from "@/lib/storage/r2/private-object-store";
import { createBoardAssetResponse } from "./response";

const asset = {
  id: "22222222-2222-4222-8222-222222222222",
  mimeType: "video/webm",
  byteSize: 8,
  contentHash: "a".repeat(64),
};

describe("createBoardAssetResponse", () => {
  it("serves bounded byte ranges from legacy Postgres content", async () => {
    const response = await createBoardAssetResponse(
      { ...asset, content: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]) },
      "member",
      new Request("https://fabric.test/asset", { headers: { Range: "bytes=2-5" } }),
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/8");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
  });

  it("keeps the stable API read while proxying the exact Range to private R2", async () => {
    const get = vi.fn(async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([4, 5]));
          controller.close();
        },
      }),
      byteSize: 2,
      contentRange: "bytes 4-5/8",
      contentType: "video/webm",
      etag: "r2-etag",
    }));
    const store = {
      get,
      createUpload: vi.fn(),
      inspect: vi.fn(),
      delete: vi.fn(),
    } as unknown as PrivateObjectStore;
    const response = await createBoardAssetResponse(
      {
        ...asset,
        content: null,
        storageState: "r2_ready",
        r2ObjectKey: "boards/one/uploads/two",
      },
      "share",
      new Request("https://fabric.test/asset", { headers: { Range: "bytes=4-5" } }),
      store,
    );
    expect(response.status).toBe(206);
    expect(get).toHaveBeenCalledWith({
      bucket: "board-assets",
      key: "boards/one/uploads/two",
      range: "bytes=4-5",
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5]));
  });
});

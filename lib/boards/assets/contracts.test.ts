import { describe, expect, it } from "vitest";

import { BoardApiError } from "@/lib/boards/http";
import { readBoundedBinaryBody } from "./binary-body";
import {
  DeleteBoardAssetsSchema,
  declaredMimeMatchesDetected,
  decodeAssetFileName,
  detectBoardAssetMimeType,
} from "./contracts";

describe("board asset contracts", () => {
  it.each([
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [new TextEncoder().encode("GIF89a"), "image/gif"],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
    [new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), "video/mp4"],
    [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), "video/webm"],
  ] as const)("detects validated image magic bytes", (bytes, expected) => {
    expect(detectBoardAssetMimeType(bytes)).toBe(expected);
  });

  it("rejects disguised or unsupported binaries", () => {
    expect(detectBoardAssetMimeType(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(declaredMimeMatchesDetected("image/jpeg", "image/png")).toBe(false);
    expect(declaredMimeMatchesDetected("application/octet-stream", "image/png")).toBe(true);
  });

  it("normalizes encoded filenames without retaining paths or controls", () => {
    expect(decodeAssetFileName(encodeURIComponent("../folder/hero\u0000.png"))).toBe("hero.png");
    expect(decodeAssetFileName("%not-valid")).toBeNull();
  });

  it("requires unique, bounded tldraw asset IDs for deletion", () => {
    expect(DeleteBoardAssetsSchema.safeParse({ assetIds: ["asset:a", "asset:b"] }).success).toBe(true);
    expect(DeleteBoardAssetsSchema.safeParse({ assetIds: ["asset:a", "asset:a"] }).success).toBe(false);
    expect(DeleteBoardAssetsSchema.safeParse({ assetIds: ["shape:a"] }).success).toBe(false);
  });
});

describe("readBoundedBinaryBody", () => {
  it("reads a body only while it stays within the explicit limit", async () => {
    const request = new Request("https://fabric.test/upload", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    expect(await readBoundedBinaryBody(request, 3)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects oversized and encoded bodies before persistence", async () => {
    const oversized = new Request("https://fabric.test/upload", {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]),
    });
    await expect(readBoundedBinaryBody(oversized, 3)).rejects.toMatchObject({
      status: 413,
      code: "asset_too_large",
    } satisfies Partial<BoardApiError>);

    const encoded = new Request("https://fabric.test/upload", {
      method: "POST",
      headers: { "Content-Encoding": "gzip" },
      body: new Uint8Array([1]),
    });
    await expect(readBoundedBinaryBody(encoded, 3)).rejects.toMatchObject({
      status: 415,
      code: "unsupported_content_encoding",
    } satisfies Partial<BoardApiError>);
  });
});

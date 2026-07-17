import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  getBoardPreviewMetadata: vi.fn(),
  getBoardPreviewSource: vi.fn(),
  renderBoardThumbnail: vi.fn(),
}));

vi.mock("@/lib/auth/require-principal", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));
vi.mock("@/lib/boards/preview-repository", () => ({
  getBoardPreviewMetadata: mocks.getBoardPreviewMetadata,
  getBoardPreviewSource: mocks.getBoardPreviewSource,
}));
vi.mock("@/lib/boards/server/board-thumbnail", () => ({
  renderBoardThumbnail: mocks.renderBoardThumbnail,
}));

import { BoardApiError } from "@/lib/boards/http";
import { GET } from "./route";

const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";
const BOARD_ID = "0bcb645c-3e28-459e-8369-a03582185d87";
const METADATA = {
  boardId: BOARD_ID,
  workspaceId: "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f",
  documentGenerationId: "740afc4d-43d8-4876-bc21-5189ad4c28ef",
  revision: 9,
} as const;
const DOCUMENT = { version: 1 as const, nodes: [], edges: [] };

function request(site = "same-origin", headers?: HeadersInit) {
  return new Request(
    `https://fabric.test/api/boards/${BOARD_ID}/thumbnail?v=ignored-scope`,
    { headers: { "sec-fetch-site": site, ...headers } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePrincipal.mockResolvedValue({ id: USER_ID });
  mocks.getBoardPreviewMetadata.mockResolvedValue(METADATA);
  mocks.getBoardPreviewSource.mockResolvedValue({
    ...METADATA,
    document: DOCUMENT,
  });
  mocks.renderBoardThumbnail.mockResolvedValue(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  );
});

describe("board thumbnail route", () => {
  it("serves an authenticated same-origin PNG with hardened private headers", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ boardId: BOARD_ID }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    expect(response.headers.get("cache-control")).not.toContain("no-store");
    expect(response.headers.get("surrogate-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toMatch(/^"sha256-[0-9a-f]{64}"$/u);
    expect(mocks.getBoardPreviewMetadata).toHaveBeenCalledWith(USER_ID, BOARD_ID);
    expect(mocks.getBoardPreviewSource).toHaveBeenCalledWith(METADATA);
    expect(mocks.getBoardPreviewSource).toHaveBeenCalledTimes(1);
    expect(mocks.renderBoardThumbnail).toHaveBeenCalledWith(DOCUMENT);
  });

  it("reauthorizes a private cached response and returns 304 before loading the document", async () => {
    const initial = await GET(request(), {
      params: Promise.resolve({ boardId: BOARD_ID }),
    });
    const etag = initial.headers.get("etag");
    expect(etag).toBeTruthy();

    vi.clearAllMocks();
    const response = await GET(
      request("same-origin", { "if-none-match": `W/${etag}` }),
      { params: Promise.resolve({ boardId: BOARD_ID }) },
    );

    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("surrogate-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBe(etag);
    expect(mocks.requirePrincipal).toHaveBeenCalledTimes(1);
    expect(mocks.getBoardPreviewMetadata).toHaveBeenCalledWith(USER_ID, BOARD_ID);
    expect(mocks.getBoardPreviewSource).not.toHaveBeenCalled();
    expect(mocks.renderBoardThumbnail).not.toHaveBeenCalled();
  });

  it("never honors a matching validator after board access is revoked", async () => {
    const initial = await GET(request(), {
      params: Promise.resolve({ boardId: BOARD_ID }),
    });
    const etag = initial.headers.get("etag");
    expect(etag).toBeTruthy();

    vi.clearAllMocks();
    mocks.getBoardPreviewMetadata.mockRejectedValueOnce(
      new BoardApiError(404, "not_found", "The requested resource was not found."),
    );
    const response = await GET(
      request("same-origin", { "if-none-match": String(etag) }),
      { params: Promise.resolve({ boardId: BOARD_ID }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.requirePrincipal).toHaveBeenCalledTimes(1);
    expect(mocks.getBoardPreviewMetadata).toHaveBeenCalledWith(USER_ID, BOARD_ID);
    expect(mocks.getBoardPreviewSource).not.toHaveBeenCalled();
    expect(mocks.renderBoardThumbnail).not.toHaveBeenCalled();
  });

  it("rejects cross-site image requests before reading private state", async () => {
    const response = await GET(request("cross-site"), {
      params: Promise.resolve({ boardId: BOARD_ID }),
    });
    expect(response.status).toBe(403);
    expect(mocks.requirePrincipal).not.toHaveBeenCalled();
    expect(mocks.getBoardPreviewMetadata).not.toHaveBeenCalled();
    expect(mocks.getBoardPreviewSource).not.toHaveBeenCalled();
  });

  it("validates the path UUID and preserves hidden authorization failures", async () => {
    const invalid = await GET(request(), {
      params: Promise.resolve({ boardId: "not-a-board" }),
    });
    expect(invalid.status).toBe(422);
    expect(mocks.getBoardPreviewMetadata).not.toHaveBeenCalled();
    expect(mocks.getBoardPreviewSource).not.toHaveBeenCalled();

    mocks.getBoardPreviewMetadata.mockRejectedValueOnce(
      new BoardApiError(404, "not_found", "The requested resource was not found."),
    );
    const hidden = await GET(request(), {
      params: Promise.resolve({ boardId: BOARD_ID }),
    });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({
      error: {
        code: "not_found",
        message: "The requested resource was not found.",
      },
    });
    expect(mocks.getBoardPreviewSource).not.toHaveBeenCalled();
    expect(mocks.renderBoardThumbnail).not.toHaveBeenCalled();
  });
});

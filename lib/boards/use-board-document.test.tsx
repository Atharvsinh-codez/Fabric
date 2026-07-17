// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardDetail } from "@/lib/boards/client";
import { useBoardDocument } from "./use-board-document";

const mocks = vi.hoisted(() => ({
  getBoard: vi.fn(),
  updateBoardDocument: vi.fn(),
}));

vi.mock("@/lib/boards/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/boards/client")>()),
  getBoard: mocks.getBoard,
  updateBoardDocument: mocks.updateBoardDocument,
}));

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const PRINCIPAL_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
type HookState = ReturnType<typeof useBoardDocument>;

function boardDetail(overrides: Partial<BoardDetail> = {}): BoardDetail {
  return {
    id: BOARD_ID,
    workspaceId: "44444444-4444-4444-8444-444444444444",
    projectId: "55555555-5555-4555-8555-555555555555",
    projectName: "Project",
    ownerId: PRINCIPAL_ID,
    title: "Board",
    cover: null,
    status: "active",
    sharingPolicy: "workspace",
    revision: 7,
    documentGenerationId: GENERATION_ID,
    role: "owner",
    favorite: false,
    pinned: false,
    lastOpenedAt: null,
    archivedAt: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    document: {
      version: 1,
      nodes: [],
      edges: [],
      tldraw: {
        version: 1,
        snapshot: {
          store: {},
          schema: { schemaVersion: 2, sequences: {} },
        },
      },
    },
    ...overrides,
  };
}

describe("board document agent checkpoint refresh", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: HookState | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    window.localStorage.clear();
    mocks.getBoard.mockReset();
    mocks.updateBoardDocument.mockReset();
    latest = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function Harness() {
    latest = useBoardDocument(BOARD_ID, PRINCIPAL_ID);
    return null;
  }

  async function mountLoadedBoard(board = boardDetail()) {
    mocks.getBoard.mockResolvedValueOnce(board);
    act(() => root.render(<Harness />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(latest?.loadState).toBe("ready");
  }

  it("adopts an exact authoritative revision without remounting the live editor", async () => {
    const initial = boardDetail();
    await mountLoadedBoard(initial);
    const initialCanvas = latest!.canvas!;
    const initialEditorVersion = latest!.editorVersion;
    const refreshed = boardDetail({
      revision: 9,
      updatedAt: "2026-07-17T00:01:00.000Z",
      document: structuredClone(initial.document),
    });
    let resolveRefresh!: (value: BoardDetail) => void;
    mocks.getBoard.mockImplementationOnce(
      () => new Promise<BoardDetail>((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const first = latest!.refreshAgentCheckpoint(initialCanvas);
    const coalesced = latest!.refreshAgentCheckpoint(initialCanvas);
    expect(coalesced).toBe(first);

    let result: Awaited<typeof first> | undefined;
    await act(async () => {
      resolveRefresh(refreshed);
      result = await first;
    });

    expect(result).toEqual({
      revision: 9,
      documentGenerationId: GENERATION_ID,
    });
    expect(latest!.board?.revision).toBe(9);
    expect(latest!.editorVersion).toBe(initialEditorVersion);
    expect(latest!.canvas).toBe(initialCanvas);
    expect(mocks.getBoard).toHaveBeenCalledTimes(2);
    expect(mocks.updateBoardDocument).not.toHaveBeenCalled();
  });

  it("refuses a revision whose authoritative checkpoint differs from the editor", async () => {
    await mountLoadedBoard();
    const initialCanvas = latest!.canvas!;
    mocks.getBoard.mockResolvedValueOnce(boardDetail({
      revision: 9,
      document: {
        version: 1,
        nodes: [{
          id: "remote-note",
          type: "note",
          title: "Remote",
          x: 0,
          y: 0,
          width: 180,
          height: 120,
          fill: "#ffffff",
        }],
        edges: [],
        tldraw: structuredClone(boardDetail().document.tldraw),
      },
    }));

    let result: Awaited<ReturnType<HookState["refreshAgentCheckpoint"]>> | undefined;
    await act(async () => {
      result = await latest!.refreshAgentCheckpoint(initialCanvas);
    });

    expect(result).toBeNull();
    expect(latest!.board?.revision).toBe(7);
    expect(latest!.canvas).toBe(initialCanvas);
  });

  it("does not adopt metadata when a local save becomes pending during refresh", async () => {
    const initial = boardDetail();
    await mountLoadedBoard(initial);
    const initialCanvas = latest!.canvas!;
    let resolveRefresh!: (value: BoardDetail) => void;
    mocks.getBoard.mockImplementationOnce(
      () => new Promise<BoardDetail>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    const refresh = latest!.refreshAgentCheckpoint(initialCanvas);

    act(() => {
      latest!.queueCanvasChange({
        ...initialCanvas,
        nodes: [{
          id: "local-note",
          type: "note",
          title: "Local",
          x: 0,
          y: 0,
          width: 180,
          height: 120,
          fill: "#ffffff",
        }],
      });
    });

    let result: Awaited<typeof refresh> | undefined;
    await act(async () => {
      resolveRefresh(boardDetail({ revision: 9 }));
      result = await refresh;
    });

    expect(result).toBeNull();
    expect(latest!.board?.revision).toBe(7);
  });
});

// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tldraw", async () => {
  const React = await import("react");
  return {
    Tldraw: ({ children }: { children?: ReactNode }) => React.createElement(
      "div",
      { "data-testid": "tldraw" },
      children,
    ),
  };
});

vi.mock("@/components/fabric-whiteboard/ai-panel", () => ({
  FabricAiPanel: () => null,
}));
vi.mock("@/components/fabric-whiteboard/board-tools-panel", () => ({
  FabricBoardToolsPanel: () => null,
}));
vi.mock("@/components/fabric-whiteboard/canvas-chrome", () => ({
  fabricCanvasComponents: {},
}));
vi.mock("@/components/fabric-whiteboard/checkpoint-dialog", () => ({
  FabricCheckpointDialog: () => null,
}));
vi.mock("@/components/fabric-whiteboard/comments-panel", () => ({
  FabricCommentsPanel: () => null,
}));
vi.mock("@/components/fabric-whiteboard/export-dialog", () => ({
  FabricExportDialog: () => null,
}));
vi.mock("@/components/fabric-whiteboard/fabric-dialog", () => ({
  FabricDialog: ({
    open,
    title,
    description,
    children,
  }: {
    open: boolean;
    title: string;
    description?: string;
    children: ReactNode;
  }) => open ? (
    <section role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ) : null,
}));
vi.mock("@/components/fabric-whiteboard/presence-summary", () => ({
  PresenceSummary: () => null,
  remotePresenceEntries: () => [],
}));
vi.mock("@/components/fabric-whiteboard/share-dialog", () => ({
  FabricShareDialog: () => null,
}));

import {
  FabricWhiteboard,
  type FabricWhiteboardProps,
} from "./fabric-whiteboard";

const documentAdapter = {
  source: { kind: "snapshot" as const },
  toCanvasDocument: vi.fn(),
  ai: {} as FabricWhiteboardProps["documentAdapter"]["ai"],
};

function whiteboardProps(
  overrides: Partial<FabricWhiteboardProps> = {},
): FabricWhiteboardProps {
  return {
    boardId: "board-id",
    workspaceId: "workspace-id",
    boardTitle: "Planning board",
    boardOwnerId: "owner-id",
    boardProjectId: "project-id",
    boardSharingPolicy: "workspace",
    archivedAt: null,
    role: "owner",
    editingAuthorized: true,
    sharingAdministrationAuthorized: true,
    organizationEnabled: false,
    privateMediaEnabled: false,
    accessLost: false,
    documentGenerationId: "generation-id",
    durableSequence: 1,
    documentAdapter,
    syncState: "synced",
    agentBoardReadiness: "ready",
    syncMessage: null,
    onRetrySave: vi.fn(),
    onReloadRemote: vi.fn(),
    onDownloadLocalCopy: vi.fn(),
    onOpenWorkspace: vi.fn(),
    onCheckpointRestored: vi.fn(),
    onBoardAccessChanged: vi.fn(),
    ...overrides,
  };
}

describe("FabricWhiteboard sync recovery visibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render(props: FabricWhiteboardProps) {
    act(() => root.render(<FabricWhiteboard {...props} />));
  }

  it("keeps sync errors out of the toolbar and board canvas while editing", () => {
    render(whiteboardProps({
      syncState: "error",
      syncMessage: "Realtime access to this board is no longer available.",
    }));

    expect(container.querySelector("[data-sync-state]")).toBeNull();
    expect(container.querySelector('[aria-label="Board Sync Notice"]')).toBeNull();
    expect(container.textContent).not.toContain("Save Needs Attention");
    expect(container.textContent).not.toContain(
      "Realtime access to this board is no longer available.",
    );
  });

  it("offers recovery only after an attempted leave and still allows leaving", () => {
    const onOpenWorkspace = vi.fn();
    render(whiteboardProps({
      syncState: "error",
      syncMessage: "Fabric could not save this board.",
      onOpenWorkspace,
    }));

    const openWorkspace = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open Workspace"]',
    );
    act(() => openWorkspace?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onOpenWorkspace).not.toHaveBeenCalled();
    const recovery = container.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Save Needs Attention"]',
    );
    expect(recovery?.textContent).toContain("Fabric could not save this board.");
    expect(recovery?.textContent).toContain("Retry Save");
    expect(recovery?.textContent).toContain("Download Local Copy");
    expect(recovery?.textContent).toContain("Reload Remote Board");

    const leaveBoard = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Leave Board");
    act(() => leaveBoard?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onOpenWorkspace).toHaveBeenCalledOnce();
    expect(container.querySelector("[role=\"dialog\"]")).toBeNull();
  });

  it("opens the workspace immediately when the board is synced", () => {
    const onOpenWorkspace = vi.fn();
    render(whiteboardProps({ onOpenWorkspace }));

    const openWorkspace = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open Workspace"]',
    );
    act(() => openWorkspace?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onOpenWorkspace).toHaveBeenCalledOnce();
    expect(container.querySelector("[role=\"dialog\"]")).toBeNull();
  });
});

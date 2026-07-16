// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiProposalRequest } from "@/lib/ai/proposal-request";

const aiClient = vi.hoisted(() => ({
  cancelAiProposal: vi.fn(async () => undefined),
  finalizeAiProposal: vi.fn(async () => ({ status: "approved" })),
  streamAiProposal: vi.fn(),
}));

vi.mock("@/lib/ai/client", () => ({
  AiProposalClientError: class AiProposalClientError extends Error {
    readonly code = "test_error";
  },
  ...aiClient,
}));

import {
  FabricAiPanel,
  type FabricWhiteboardAiAdapter,
} from "./ai-panel";

const oneObjectSelection = [{
  id: "shape:one",
  type: "note" as const,
  title: "Customer evidence",
  x: 0,
  y: 0,
  width: 160,
  height: 120,
}];

const twoObjectSelection = [
  ...oneObjectSelection,
  {
    id: "shape:two",
    type: "text" as const,
    title: "Working hypothesis",
    x: 220,
    y: 0,
    width: 180,
    height: 100,
  },
];

const canvasPreview = {
  patch: {
    schemaVersion: 1 as const,
    summary: "I drafted a concise synthesis beside the selected evidence.",
    base: {
      workspaceId: "workspace:test",
      boardId: "board:test",
      documentGenerationId: "generation:test",
      durableSequence: 1,
    },
    operations: [{
      type: "createNode" as const,
      nodeType: "summary" as const,
      tempId: "tmp_canvas_summary",
      position: { x: 200, y: 200 },
      size: { width: 320, height: 180 },
      content: { title: "Synthesis", body: "Clarify the evidence." },
    }],
  },
  patchHash: "a".repeat(64),
  patchBytes: 512,
  affectedNodeIds: ["tmp_canvas_summary"],
  riskClass: "low" as const,
};

function createEditorHarness() {
  const listeners = new Set<() => void>();
  const editor = {
    store: {
      listen: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    getSelectedShapes: () => [],
    getViewportPageBounds: () => ({ x: 100, y: 200, w: 960, h: 640 }),
  } as unknown as Editor;

  return {
    editor,
    emitSelectionChange: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe("Fabric AI canvas sidebar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    aiClient.cancelAiProposal.mockClear();
    aiClient.finalizeAiProposal.mockClear();
    aiClient.streamAiProposal.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function renderPanel({
    editor,
    getSelection,
    applyProposal = async () => undefined,
    onClose = vi.fn(),
  }: {
    editor: Editor;
    getSelection: () => AiProposalRequest["selection"];
    applyProposal?: FabricWhiteboardAiAdapter["applyProposal"];
    onClose?: () => void;
  }) {
    act(() => {
      root.render(
        <FabricAiPanel
          editor={editor}
          boardId="board:test"
          workspaceId="workspace:test"
          documentGenerationId="generation:test"
          durableSequence={1}
          adapter={{ getSelection, applyProposal }}
          open
          persistenceReady
          readChangeVersion={() => 0}
          onFinalizingChange={() => undefined}
          onClose={onClose}
        />,
      );
    });
  }

  function writePrompt(value: string) {
    const textarea = container.querySelector<HTMLTextAreaElement>(
      "#fabric-ai-instruction",
    );
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      valueSetter?.call(textarea, value);
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function sendPrompt() {
    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("sends an empty selection with the viewport and renders chat history plus a safe preview", async () => {
    const { editor } = createEditorHarness();
    aiClient.streamAiProposal.mockImplementation(
      ({ onRunId }: { onRunId?: (runId: string) => void }) => {
        onRunId?.("run:canvas");
        return Promise.resolve(canvasPreview);
      },
    );
    renderPanel({
      editor,
      getSelection: () => [],
    });

    expect(container.textContent).toContain("No Selection");
    expect(container.textContent).toContain("Fabric AI will use the visible canvas.");

    writePrompt("Write a clear three-step launch plan.");
    await sendPrompt();

    const request = aiClient.streamAiProposal.mock.calls[0]?.[0]?.request;
    expect(request).toEqual(expect.objectContaining({
      skill: "canvas-agent",
      instruction: "Write a clear three-step launch plan.",
      selection: [],
      viewport: { x: 100, y: 200, width: 960, height: 640 },
      conversation: [],
    }));
    expect(request).not.toHaveProperty("mode");
    expect(container.textContent).toContain("Write a clear three-step launch plan.");
    expect(container.textContent).toContain(
      "I drafted a concise synthesis beside the selected evidence.",
    );
    expect(container.textContent).toContain("Change Preview");
    expect(container.textContent).toContain("Apply Changes");
    expect(container.textContent).toContain("Discard");

    act(() => root.render(null));
    expect(aiClient.cancelAiProposal).toHaveBeenCalledWith("run:canvas");
  });

  it("tracks the editor selection and snapshots the latest objects when sending", async () => {
    const { editor, emitSelectionChange } = createEditorHarness();
    let selected: AiProposalRequest["selection"] = oneObjectSelection;
    aiClient.streamAiProposal.mockImplementation(
      ({ onRunId }: { onRunId?: (runId: string) => void }) => {
        onRunId?.("run:selection");
        return Promise.resolve(canvasPreview);
      },
    );
    renderPanel({ editor, getSelection: () => selected });

    expect(container.textContent).toContain("1 Object Selected");
    expect(container.textContent).toContain("1 note");

    selected = twoObjectSelection;
    act(() => emitSelectionChange());
    expect(container.textContent).toContain("2 Objects Selected");
    expect(container.textContent).toContain("1 note · 1 text block");

    writePrompt("Connect these ideas and write the missing conclusion.");
    await sendPrompt();

    expect(aiClient.streamAiProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ selection: twoObjectSelection }),
      }),
    );
  });

  it("shows streamed progress, supports cancel, and keeps close available", async () => {
    const { editor } = createEditorHarness();
    const onClose = vi.fn();
    aiClient.streamAiProposal.mockImplementation(({
      onRunId,
      onEvent,
      signal,
    }: {
      onRunId?: (runId: string) => void;
      onEvent?: (event: unknown) => void;
      signal: AbortSignal;
    }) => {
      onRunId?.("run:streaming");
      onEvent?.({
        type: "run.progress",
        payload: { message: "Writing a structured answer…" },
      });
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException(
          "Aborted",
          "AbortError",
        )));
      });
    });
    renderPanel({
      editor,
      getSelection: () => twoObjectSelection,
      onClose,
    });

    writePrompt("Turn this into a decision map.");
    await sendPrompt();
    expect(container.textContent).toContain("Writing a structured answer…");

    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close Fabric AI"]',
    );
    expect(close?.disabled).toBe(false);
    act(() => close?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();

    const cancel = container.querySelector<HTMLButtonElement>(
      '[aria-label="Cancel AI Response"]',
    );
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(aiClient.cancelAiProposal).toHaveBeenCalledWith("run:streaming");
    expect(container.textContent).toContain("Request canceled.");
  });
});

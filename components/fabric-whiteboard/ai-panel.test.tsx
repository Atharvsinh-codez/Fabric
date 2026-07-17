// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiClient = vi.hoisted(() => ({
  cancelAiProposal: vi.fn(async () => undefined),
  finalizeAiProposal: vi.fn(async () => ({ status: "approved" })),
  streamAiProposal: vi.fn(),
}));

vi.mock("@/lib/ai/client", () => ({
  AiProposalClientError: class AiProposalClientError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly status?: number;

    constructor(
      code: string,
      message: string,
      options: { retryable?: boolean; status?: number } = {},
    ) {
      super(message);
      this.name = "AiProposalClientError";
      this.code = code;
      this.retryable = options.retryable ?? false;
      this.status = options.status;
    }
  },
  ...aiClient,
}));

import { AiProposalClientError } from "@/lib/ai/client";
import {
  FabricAiPanel,
  type FabricWhiteboardAiAdapter,
} from "./ai-panel";

const canvasPreview = {
  patch: {
    schemaVersion: 1 as const,
    summary: "I drafted a concise synthesis from the visible canvas.",
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
  const getSelectedShapes = vi.fn(() => []);
  const editor = {
    getSelectedShapes,
    getViewportPageBounds: () => ({ x: 100, y: 200, w: 960, h: 640 }),
  } as unknown as Editor;

  return {
    editor,
    getSelectedShapes,
  };
}

describe("Fabric agent canvas sidebar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    aiClient.cancelAiProposal.mockClear();
    aiClient.finalizeAiProposal.mockReset();
    aiClient.finalizeAiProposal.mockResolvedValue({ status: "approved" });
    aiClient.streamAiProposal.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function renderPanel({
    editor,
    applyProposal = async () => undefined,
    onClose = vi.fn(),
    onFinalizingChange = vi.fn(),
    boardReadiness = "ready",
    onRetrySync = vi.fn(),
    onRefreshCheckpoint = vi.fn(async () => null),
    durableSequence = 1,
  }: {
    editor: Editor;
    applyProposal?: FabricWhiteboardAiAdapter["applyProposal"];
    onClose?: () => void;
    onFinalizingChange?: (finalizing: boolean) => void;
    boardReadiness?: "ready" | "syncing" | "needs-retry";
    onRetrySync?: () => void;
    onRefreshCheckpoint?: () => Promise<{
      revision: number;
      documentGenerationId: string;
    } | null>;
    durableSequence?: number;
  }) {
    act(() => {
      root.render(
        <FabricAiPanel
          editor={editor}
          boardId="board:test"
          workspaceId="workspace:test"
          documentGenerationId="generation:test"
          durableSequence={durableSequence}
          adapter={{ applyProposal }}
          open
          boardReadiness={boardReadiness}
          readChangeVersion={() => 0}
          onFinalizingChange={onFinalizingChange}
          onRetrySync={onRetrySync}
          onRefreshCheckpoint={onRefreshCheckpoint}
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
    renderPanel({ editor });

    expect(container.textContent).toContain("Make the board clearer");
    expect(container.textContent).toContain("Try a starting point");
    expect(container.textContent).toContain("show you every change before it is applied");
    expect(container.textContent).not.toMatch(/No Selection|Objects? Selected/i);
    const panel = container.querySelector<HTMLElement>(
      '[aria-label="Fabric agent"]',
    );
    expect(panel?.querySelector("h2")?.textContent).toBe("Fabric agent");
    expect(
      panel?.querySelector<HTMLElement>("[data-ai-model-name]")?.textContent?.trim(),
    ).toBe("Fabric agent");
    expect(
      panel?.querySelector<HTMLTextAreaElement>("#fabric-ai-instruction")?.placeholder,
    ).toBe("Describe what you want on the board…");
    expect(panel?.className).toContain("inset-x-2");
    expect(panel?.className).toContain("bottom-2");
    expect(panel?.className).toContain("rounded-radius-2xl");
    expect(panel?.className).toContain("sm:left-3");
    expect(panel?.className).toContain("sm:right-auto");
    expect(panel?.className).toContain("sm:w-[23rem]");
    expect(panel?.className).toContain("sm:h-[min(42rem,calc(100dvh-5rem))]");
    expect(panel?.className).toContain("sm:bottom-auto");
    expect(panel?.className).not.toContain("sm:rounded-none");
    expect(container.querySelector("[data-wave-spinner]")).toBeNull();
    expect(
      panel?.querySelector('[aria-label="Close Fabric agent"]')?.getAttribute(
        "data-tooltip-align",
      ),
    ).toBe("end");

    const starter = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Turn this board into a clear action plan.",
    );
    expect(starter?.className).toContain("break-words");
    act(() => starter?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(
      panel?.querySelector<HTMLTextAreaElement>("#fabric-ai-instruction")?.value,
    ).toBe("Turn this board into a clear action plan.");

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
      "I drafted a concise synthesis from the visible canvas.",
    );
    expect(container.textContent).toContain("Review Changes");
    expect(container.textContent).toContain("Apply Changes");
    expect(container.textContent).toContain("Discard Preview");
    expect(container.querySelector("[data-wave-spinner]")).toBeNull();

    act(() => root.render(null));
    expect(aiClient.cancelAiProposal).toHaveBeenCalledWith("run:canvas");
  });

  it("shows ordinary board sync as a calm, compact status", () => {
    const { editor } = createEditorHarness();
    renderPanel({ editor, boardReadiness: "syncing" });

    const syncStatus = container.querySelector<HTMLElement>(
      "[data-ai-sync-status]",
    );
    expect(syncStatus?.dataset.tone).toBe("neutral");
    expect(syncStatus?.textContent).toContain("Syncing Board…");
    expect(syncStatus?.textContent).toContain(
      "Fabric agent will be ready as soon as this board is up to date.",
    );
    expect(syncStatus?.className).toContain("text-muted-gray");
    expect(syncStatus?.className).not.toContain("warning");
    expect(
      syncStatus?.querySelector<HTMLElement>("[data-wave-spinner]")?.dataset.animation,
    ).toBe("ripple");
    expect(
      container.querySelector<HTMLTextAreaElement>("#fabric-ai-instruction")?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Send Message"]')?.disabled,
    ).toBe(true);
    expect(container.textContent).not.toContain("finish syncing");
  });

  it("offers a retry instead of spinning forever when board persistence is blocked", () => {
    const { editor } = createEditorHarness();
    const onRetrySync = vi.fn();
    renderPanel({ editor, boardReadiness: "needs-retry", onRetrySync });

    const syncStatus = container.querySelector<HTMLElement>(
      "[data-ai-sync-status]",
    );
    expect(syncStatus?.dataset.syncReadiness).toBe("needs-retry");
    expect(syncStatus?.textContent).toContain("Board Save Paused");
    expect(syncStatus?.textContent).not.toContain("Syncing Board…");
    expect(syncStatus?.querySelector("[data-wave-spinner]")).toBeNull();

    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Retry");
    act(() => retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onRetrySync).toHaveBeenCalledOnce();
    expect(
      container.querySelector<HTMLTextAreaElement>("#fabric-ai-instruction")?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Send Message"]')?.disabled,
    ).toBe(true);
  });

  it("always uses the visible canvas and never reads the editor selection", async () => {
    const { editor, getSelectedShapes } = createEditorHarness();
    aiClient.streamAiProposal.mockImplementation(
      ({ onRunId }: { onRunId?: (runId: string) => void }) => {
        onRunId?.("run:visible-canvas");
        return Promise.resolve(canvasPreview);
      },
    );
    renderPanel({ editor });

    writePrompt("Connect the visible ideas and write the missing conclusion.");
    await sendPrompt();

    expect(aiClient.streamAiProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          selection: [],
          viewport: { x: 100, y: 200, width: 960, height: 640 },
        }),
      }),
    );
    expect(getSelectedShapes).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/No Selection|Objects? Selected/i);
  });

  it("silently retries one stale sequence with the latest checkpoint and no duplicate message", async () => {
    const { editor } = createEditorHarness();
    const onRefreshCheckpoint = vi.fn(async () => ({
      revision: 2,
      documentGenerationId: "generation:test",
    }));
    aiClient.streamAiProposal
      .mockRejectedValueOnce(new AiProposalClientError(
        "stale_sequence",
        "The board changed before the AI run was created.",
      ))
      .mockImplementationOnce(
        ({ onRunId }: { onRunId?: (runId: string) => void }) => {
          onRunId?.("run:stale-retry");
          return Promise.resolve(canvasPreview);
        },
      );
    renderPanel({ editor, durableSequence: 1, onRefreshCheckpoint });

    const instruction = "Create a launch plan from everything visible.";
    writePrompt(instruction);
    await sendPrompt();

    expect(aiClient.streamAiProposal).toHaveBeenCalledTimes(2);
    expect(onRefreshCheckpoint).toHaveBeenCalledOnce();
    const firstCall = aiClient.streamAiProposal.mock.calls[0]?.[0];
    const retryCall = aiClient.streamAiProposal.mock.calls[1]?.[0];
    expect(firstCall?.request).toEqual(expect.objectContaining({
      durableSequence: 1,
      instruction,
      selection: [],
      viewport: { x: 100, y: 200, width: 960, height: 640 },
      conversation: [],
    }));
    expect(retryCall?.request).toEqual({
      ...firstCall?.request,
      durableSequence: 2,
    });
    expect(retryCall?.signal).toBe(firstCall?.signal);
    const visibleInstructionMessages = [...container.querySelectorAll("li p")]
      .filter((node) => node.textContent === instruction);
    expect(visibleInstructionMessages).toHaveLength(1);
    expect(container.textContent).toContain("Review Changes");
    expect(container.textContent).not.toContain("Request Needs Attention");
  });

  it("never retries a non-stale typed failure", async () => {
    const { editor } = createEditorHarness();
    const onRefreshCheckpoint = vi.fn(async () => ({
      revision: 2,
      documentGenerationId: "generation:test",
    }));
    aiClient.streamAiProposal.mockRejectedValue(new AiProposalClientError(
      "provider_unavailable",
      "Fabric agent is temporarily unavailable.",
    ));
    renderPanel({ editor, onRefreshCheckpoint });

    writePrompt("Summarize the visible board.");
    await sendPrompt();

    expect(aiClient.streamAiProposal).toHaveBeenCalledTimes(1);
    expect(onRefreshCheckpoint).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Fabric agent is temporarily unavailable.");
  });

  it.each([
    ["unavailable", null],
    ["a replaced document", {
      revision: 2,
      documentGenerationId: "generation:replacement",
    }],
    ["a non-advancing revision", {
      revision: 1,
      documentGenerationId: "generation:test",
    }],
  ] as const)(
    "does not retry stale sequence after checkpoint refresh reports %s",
    async (_case, refreshedCheckpoint) => {
      const { editor } = createEditorHarness();
      const onRefreshCheckpoint = vi.fn(async () => refreshedCheckpoint);
      aiClient.streamAiProposal.mockRejectedValue(new AiProposalClientError(
        "stale_sequence",
        "The board changed before the AI run was created.",
      ));
      renderPanel({ editor, onRefreshCheckpoint });

      writePrompt("Organize the visible canvas.");
      await sendPrompt();

      expect(onRefreshCheckpoint).toHaveBeenCalledOnce();
      expect(aiClient.streamAiProposal).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain(
        "The board changed before the AI run was created.",
      );
    },
  );

  it("limits repeated stale sequence failures to one retry", async () => {
    const { editor } = createEditorHarness();
    const onRefreshCheckpoint = vi.fn(async () => ({
      revision: 2,
      documentGenerationId: "generation:test",
    }));
    aiClient.streamAiProposal.mockRejectedValue(new AiProposalClientError(
      "stale_sequence",
      "The board changed again before the retry started.",
    ));
    renderPanel({ editor, onRefreshCheckpoint });

    writePrompt("Create a visible-canvas plan.");
    await sendPrompt();

    expect(onRefreshCheckpoint).toHaveBeenCalledOnce();
    expect(aiClient.streamAiProposal).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(
      "The board changed again before the retry started.",
    );
  });

  it("does not retry when the request is canceled during checkpoint refresh", async () => {
    const { editor } = createEditorHarness();
    let resolveRefresh: ((value: {
      revision: number;
      documentGenerationId: string;
    }) => void) | undefined;
    const onRefreshCheckpoint = vi.fn(() => new Promise<{
      revision: number;
      documentGenerationId: string;
    }>((resolve) => {
      resolveRefresh = resolve;
    }));
    aiClient.streamAiProposal.mockRejectedValueOnce(new AiProposalClientError(
      "stale_sequence",
      "The board changed before the AI run was created.",
    ));
    renderPanel({ editor, onRefreshCheckpoint });

    writePrompt("Create a visible-canvas plan.");
    await sendPrompt();
    expect(onRefreshCheckpoint).toHaveBeenCalledOnce();

    const cancel = container.querySelector<HTMLButtonElement>(
      '[aria-label="Cancel AI Response"]',
    );
    await act(async () => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      resolveRefresh?.({
        revision: 2,
        documentGenerationId: "generation:test",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(aiClient.streamAiProposal).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Request canceled.");
  });

  it("shows a model clarification as chat without an empty change preview", async () => {
    const { editor } = createEditorHarness();
    aiClient.streamAiProposal.mockResolvedValue({
      kind: "clarification",
      reason: "missing-selection",
      question: "Which notes should I organize?",
      choices: ["Use my current selection", "Create a new group"],
    });
    renderPanel({ editor });

    writePrompt("Organize this.");
    await sendPrompt();

    expect(container.textContent).toContain(
      "Tell me which part of the visible canvas to use",
    );
    expect(container.textContent).toContain("1. Use everything visible");
    expect(container.textContent).toContain("2. Create a new group");
    expect(container.textContent).not.toMatch(/select(?:ed|ion)?/i);
    expect(container.textContent).not.toContain("Review Changes");
    expect(container.textContent).not.toContain("Apply Changes");
  });

  it("keeps save confirmation calm until the exact durable receipt is confirmed", async () => {
    const { editor } = createEditorHarness();
    const applyProposal = vi.fn(async () => undefined);
    let resolveFinalize: ((value: { status: string }) => void) | undefined;
    aiClient.finalizeAiProposal.mockImplementation(() => new Promise((resolve) => {
      resolveFinalize = resolve;
    }));
    aiClient.streamAiProposal.mockImplementation(
      ({ onRunId }: { onRunId?: (runId: string) => void }) => {
        onRunId?.("run:approval");
        return Promise.resolve(canvasPreview);
      },
    );
    renderPanel({ editor, applyProposal });

    writePrompt("Create a launch plan from this canvas.");
    await sendPrompt();

    const apply = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Apply Changes",
    );
    await act(async () => {
      apply?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
    });

    expect(applyProposal).toHaveBeenCalledTimes(1);
    expect(applyProposal).toHaveBeenCalledWith(canvasPreview, editor);
    expect(aiClient.finalizeAiProposal).toHaveBeenCalledWith({
      runId: "run:approval",
      patchHash: "a".repeat(64),
      documentGenerationId: "generation:test",
      baseDurableSequence: 1,
      observedDurableSequence: 1,
    });
    const finalizingStatus = container.querySelector<HTMLElement>(
      '[data-ai-activity-stage="finalizing"]',
    );
    expect(finalizingStatus?.dataset.tone).toBe("neutral");
    expect(finalizingStatus?.textContent).toContain("Saving Changes…");
    expect(finalizingStatus?.textContent).toContain(
      "The board is updated. Fabric is confirming the save.",
    );
    expect(
      finalizingStatus?.querySelector<HTMLElement>("[data-wave-spinner]")?.dataset.animation,
    ).toBe("ripple");
    expect(container.textContent).not.toContain("Board Updated");
    expect(container.textContent).not.toContain("safely saved");

    await act(async () => {
      resolveFinalize?.({ status: "approved" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-ai-activity-stage="finalizing"]')).toBeNull();
    expect(container.textContent).toContain("Board Updated");
    expect(container.textContent).toContain("Changes applied and safely saved.");
  });

  it("retries a transient receipt failure without applying the board change twice", async () => {
    vi.useFakeTimers();
    const { editor } = createEditorHarness();
    const applyProposal = vi.fn(async () => undefined);
    aiClient.finalizeAiProposal
      .mockRejectedValueOnce(new AiProposalClientError(
        "internal_error",
        "The request could not be completed.",
        { retryable: true, status: 500 },
      ))
      .mockResolvedValueOnce({ status: "approved" });
    aiClient.streamAiProposal.mockImplementation(
      ({ onRunId }: { onRunId?: (runId: string) => void }) => {
        onRunId?.("run:transient-confirmation");
        return Promise.resolve(canvasPreview);
      },
    );
    renderPanel({ editor, applyProposal });

    writePrompt("Create a launch plan from this canvas.");
    await sendPrompt();

    const apply = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Apply Changes",
    );
    await act(async () => {
      apply?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(applyProposal).toHaveBeenCalledTimes(1);
    expect(aiClient.finalizeAiProposal).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Save Confirmation Pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(aiClient.finalizeAiProposal).toHaveBeenCalledTimes(2);
    expect(applyProposal).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Board Updated");
    expect(container.textContent).toContain("Changes applied and safely saved.");
    expect(container.textContent).not.toContain("Save Confirmation Pending");
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
      onClose,
    });

    writePrompt("Turn this into a decision map.");
    await sendPrompt();
    expect(container.textContent).toContain("Writing a structured answer…");

    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close Fabric agent"]',
    );
    expect(close?.disabled).toBe(false);
    const spinner = container.querySelector<HTMLElement>("[data-wave-spinner]");
    expect(spinner?.dataset.animation).toBe("ripple");
    expect(spinner?.dataset.pattern).toBe("square3x3");
    expect(
      container.querySelector('[aria-label="Fabric agent"]')?.getAttribute("aria-busy"),
    ).toBeNull();
    expect(
      container.querySelector('[data-wave-spinner]:not([data-animation="ripple"])'),
    ).toBeNull();
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
    expect(container.querySelector("[data-wave-spinner]")).toBeNull();
  });
});

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
    readonly code = "test_error";
  },
  ...aiClient,
}));

import { FabricAiPanel } from "./ai-panel";

const oneObjectSelection = [{
  id: "shape:one",
  type: "note" as const,
  title: "Customer evidence",
  x: 0,
  y: 0,
  width: 160,
  height: 120,
}];

const feedbackPreview = {
  patch: {
    schemaVersion: 1 as const,
    summary: "Review the selected evidence.",
    base: {
      workspaceId: "workspace:test",
      boardId: "board:test",
      documentGenerationId: "generation:test",
      durableSequence: 1,
    },
    operations: [{
      type: "createNode" as const,
      nodeType: "summary" as const,
      nodeId: "summary:feedback",
      position: { x: 200, y: 200 },
      size: { width: 320, height: 180 },
      content: { title: "Feedback", body: "Clarify the evidence." },
    }],
  },
  patchHash: "a".repeat(64),
  patchBytes: 512,
  affectedNodeIds: ["summary:feedback"],
  riskClass: "low" as const,
};

describe("Fabric AI assistance panel", () => {
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
  });

  function renderPanel(mode: "feedback" | "suggest" | "solve") {
    act(() => {
      root.render(
        <FabricAiPanel
          editor={{} as Editor}
          mode={mode}
          boardId="board:test"
          workspaceId="workspace:test"
          documentGenerationId="generation:test"
          durableSequence={1}
          adapter={{
            getSelection: () => oneObjectSelection,
            applyProposal: async () => undefined,
          }}
          open
          persistenceReady
          readChangeVersion={() => 0}
          onFinalizingChange={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
  }

  it("sends Feedback as a distinct one-object request and cancels its preview on Off/unmount", async () => {
    aiClient.streamAiProposal.mockImplementation(
      ({ onRunId }: { onRunId?: (runId: string) => void }) => {
        onRunId?.("run:feedback");
        return Promise.resolve(feedbackPreview);
      },
    );
    renderPanel("feedback");

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(aiClient.streamAiProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ mode: "feedback" }),
      }),
    );
    expect(container.textContent).toContain("Feedback Preview");

    act(() => root.render(null));
    expect(aiClient.cancelAiProposal).toHaveBeenCalledWith("run:feedback");
  });

  it("keeps Suggest preview-first and requires at least two objects", async () => {
    renderPanel("suggest");

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(aiClient.streamAiProposal).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Select at least two supported objects before generating suggestions.",
    );
    expect(container.textContent).toContain("Generate Suggestions");
  });
});

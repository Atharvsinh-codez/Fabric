"use client";

import {
  CheckIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  StopIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Editor } from "tldraw";

import { Button, IconButton, cx } from "@/components/ui";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import {
  AiProposalClientError,
  cancelAiProposal,
  finalizeAiProposal,
  streamAiProposal,
} from "@/lib/ai/client";
import type { ProposalReadyPayload } from "@/lib/ai/contracts";
import type { AiProposalRequest } from "@/lib/ai/proposal-request";

export type FabricWhiteboardAiAdapter = Readonly<{
  applyProposal: (
    proposal: ProposalReadyPayload,
    editor: Editor,
  ) => void | Promise<void>;
}>;

type AiStage =
  | "idle"
  | "running"
  | "preview"
  | "applying"
  | "finalizing"
  | "applied"
  | "canceled"
  | "error";

type PendingApproval = Readonly<{
  runId: string;
  proposal: ProposalReadyPayload;
}>;

type ConversationRole = "user" | "assistant";

type ChatMessage = Readonly<{
  id: string;
  role: ConversationRole;
  content: string;
  contextLabel?: string;
}>;

type CanvasViewport = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

const MAX_VISIBLE_MESSAGES = 50;
const MAX_REQUEST_CONVERSATION = 12;

function currentViewport(editor: Editor): CanvasViewport {
  const viewport = editor.getViewportPageBounds();
  return {
    x: clampCoordinate(viewport.x),
    y: clampCoordinate(viewport.y),
    width: clampDimension(viewport.w),
    height: clampDimension(viewport.h),
  };
}

function clampCoordinate(value: number): number {
  return Math.max(-100_000, Math.min(100_000, value));
}

function clampDimension(value: number): number {
  return Math.max(24, Math.min(10_000, value));
}

function appendMessage(
  messages: readonly ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  return [...messages, message].slice(-MAX_VISIBLE_MESSAGES);
}

export function FabricAiPanel({
  editor,
  boardId,
  workspaceId,
  documentGenerationId,
  durableSequence,
  adapter,
  open,
  persistenceReady,
  readChangeVersion,
  onFinalizingChange,
  onClose,
}: {
  editor: Editor | null;
  boardId: string;
  workspaceId: string;
  documentGenerationId: string;
  durableSequence: number;
  adapter: FabricWhiteboardAiAdapter;
  open: boolean;
  persistenceReady: boolean;
  readChangeVersion: () => number;
  onFinalizingChange: (finalizing: boolean) => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stage, setStage] = useState<AiStage>("idle");
  const [progress, setProgress] = useState("Ready for your direction.");
  const [proposal, setProposal] = useState<ProposalReadyPayload | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [approvalAttempt, setApprovalAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const previewChangeVersionRef = useRef<number | null>(null);
  const durableSequenceRef = useRef(durableSequence);
  const persistenceReadyRef = useRef(persistenceReady);
  const messageIdRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const busy = stage === "running" || stage === "applying" || stage === "finalizing";
  const composerDisabled =
    !editor ||
    !persistenceReady ||
    busy ||
    stage === "preview" ||
    pendingApproval !== null;

  const createMessage = (
    role: ConversationRole,
    content: string,
    contextLabel?: string,
  ): ChatMessage => {
    messageIdRef.current += 1;
    return {
      id: `fabric-ai-message-${messageIdRef.current}`,
      role,
      content: content.slice(0, 2_000),
      ...(contextLabel ? { contextLabel } : {}),
    };
  };

  useEffect(() => {
    durableSequenceRef.current = durableSequence;
    persistenceReadyRef.current = persistenceReady;
  }, [durableSequence, persistenceReady]);

  useEffect(() => {
    if (!open) return;
    composerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [error, messages, open, progress, proposal, stage]);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
    const activeRunId = runIdRef.current;
    runIdRef.current = null;
    if (activeRunId) {
      void cancelAiProposal(activeRunId).catch(() => undefined);
    }
    onFinalizingChange(false);
  }, [onFinalizingChange]);

  useEffect(() => {
    if (!pendingApproval || stage !== "finalizing") return;
    let canceled = false;

    const wait = () => new Promise<void>((resolve) => {
      window.setTimeout(resolve, 500);
    });
    const confirmDurableApproval = async () => {
      const baseDurableSequence = pendingApproval.proposal.patch.base.durableSequence;
      for (let attempt = 0; attempt < 60 && !canceled; attempt += 1) {
        const observedDurableSequence = durableSequenceRef.current;
        if (!persistenceReadyRef.current) {
          await wait();
          continue;
        }
        try {
          await finalizeAiProposal({
            runId: pendingApproval.runId,
            patchHash: pendingApproval.proposal.patchHash,
            documentGenerationId:
              pendingApproval.proposal.patch.base.documentGenerationId,
            baseDurableSequence,
            observedDurableSequence,
          });
          if (canceled) return;
          runIdRef.current = null;
          setPendingApproval(null);
          setStage("applied");
          setProgress("Changes applied and durably confirmed.");
          setMessages((current) => appendMessage(
            current,
            createMessage(
              "assistant",
              "The approved changes are on the board and durably confirmed.",
            ),
          ));
          onFinalizingChange(false);
          return;
        } catch (caught) {
          if (
            caught instanceof AiProposalClientError &&
            caught.code === "approval_not_durable"
          ) {
            await wait();
            continue;
          }
          if (canceled) return;
          setStage("error");
          setError(
            caught instanceof AiProposalClientError
              ? `${caught.message} The board change remains applied. Retry confirmation after sync completes.`
              : "The board change was applied, but Fabric could not confirm its durable AI receipt. Retry confirmation after sync completes.",
          );
          onFinalizingChange(false);
          return;
        }
      }
      if (!canceled) {
        setStage("error");
        setError(
          "The board change was applied, but durable AI confirmation is still pending. Check sync and retry confirmation.",
        );
        onFinalizingChange(false);
      }
    };

    void confirmDurableApproval();
    return () => {
      canceled = true;
    };
  }, [approvalAttempt, onFinalizingChange, pendingApproval, stage]);

  async function generateProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextInstruction = instruction.trim();
    if (!editor || composerDisabled || nextInstruction.length === 0) return;
    if (!persistenceReady) {
      setStage("error");
      setError("The board is still syncing. Wait for sync to finish, then send your request again.");
      return;
    }

    const visibleCanvasSelection: AiProposalRequest["selection"] = [];
    const viewportSnapshot = currentViewport(editor);
    const conversation = messages
      .slice(-MAX_REQUEST_CONVERSATION)
      .map(({ role, content }) => ({ role, content: content.slice(0, 2_000) }));
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const startChangeVersion = readChangeVersion();
    setMessages((current) => appendMessage(
      current,
      createMessage(
        "user",
        nextInstruction,
        "Visible canvas",
      ),
    ));
    setInstruction("");
    setStage("running");
    setProgress("Reading the board and preparing changes…");
    setProposal(null);
    setPendingApproval(null);
    setError(null);
    runIdRef.current = null;

    try {
      const nextResult = await streamAiProposal({
        request: {
          skill: "canvas-agent",
          boardId,
          workspaceId,
          documentGenerationId,
          durableSequence,
          instruction: nextInstruction,
          selection: visibleCanvasSelection,
          viewport: viewportSnapshot,
          conversation,
        },
        signal: controller.signal,
        onRunId: (runId) => {
          runIdRef.current = runId;
        },
        onEvent: (streamEvent) => {
          if (streamEvent.type === "run.progress") {
            const payload = streamEvent.payload as { message: string };
            setProgress(payload.message);
          } else if (streamEvent.type === "proposal.delta") {
            setProgress("Writing the board change preview…");
          }
        },
      });
      if (!("patch" in nextResult)) {
        const visibleCanvasQuestion = nextResult.reason === "missing-selection"
          ? "Tell me which part of the visible canvas to use, or describe what I should create."
          : nextResult.question;
        const visibleCanvasChoices = nextResult.reason === "missing-selection"
          ? ["Use everything visible", "Create a new group"]
          : nextResult.choices;
        const choiceText = visibleCanvasChoices.length > 0
          ? `\n\n${visibleCanvasChoices.map((choice, index) => `${index + 1}. ${choice}`).join("\n")}`
          : "";
        setMessages((current) => appendMessage(
          current,
          createMessage("assistant", `${visibleCanvasQuestion}${choiceText}`),
        ));
        setStage("idle");
        setProgress("Fabric agent needs one detail before changing the board.");
        runIdRef.current = null;
        return;
      }
      const nextProposal = nextResult;
      if (readChangeVersion() !== startChangeVersion) {
        setStage("error");
        setError(
          "The board changed while Fabric agent was working. Review the board and send your request again.",
        );
        return;
      }
      previewChangeVersionRef.current = startChangeVersion;
      setProposal(nextProposal);
      setStage("preview");
      setProgress("Preview ready for review.");
      setMessages((current) => appendMessage(
        current,
        createMessage("assistant", nextProposal.patch.summary),
      ));
    } catch (caught) {
      if (controller.signal.aborted) {
        setStage("canceled");
        setProgress("Request canceled.");
      } else {
        const message = caught instanceof AiProposalClientError
          ? caught.message
          : "Fabric agent could not prepare a preview. Check your connection and send the request again.";
        setStage("error");
        setError(message);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function cancelProposal() {
    abortRef.current?.abort();
    abortRef.current = null;
    const runId = runIdRef.current;
    runIdRef.current = null;
    setProposal(null);
    setStage("canceled");
    setProgress("Request canceled.");
    setError(null);
    previewChangeVersionRef.current = null;
    if (!runId) return;
    try {
      await cancelAiProposal(runId);
    } catch {
      setStage("error");
      setError(
        "The preview was closed, but Fabric could not confirm cancellation with the AI worker. It will expire without being applied.",
      );
    }
  }

  async function applyProposal() {
    if (!editor || !proposal || stage !== "preview") return;
    if (previewChangeVersionRef.current !== readChangeVersion()) {
      setStage("error");
      setError(
        "The board changed after this preview was created. Discard it and send a fresh request before applying changes.",
      );
      setProposal(null);
      return;
    }
    if (
      proposal.patch.base.documentGenerationId !== documentGenerationId ||
      proposal.patch.base.durableSequence !== durableSequence
    ) {
      setStage("error");
      setError(
        "This preview targets an older board version. Discard it and send a fresh request before applying changes.",
      );
      setProposal(null);
      return;
    }

    setStage("applying");
    setProgress("Applying the approved board changes…");
    setError(null);
    onFinalizingChange(true);
    try {
      const runId = runIdRef.current;
      if (!runId) throw new Error("The durable AI run receipt is missing.");
      await adapter.applyProposal(proposal, editor);
      runIdRef.current = null;
      setProposal(null);
      setPendingApproval({ runId, proposal });
      setStage("finalizing");
      setProgress("Saving the approved changes and confirming their durable receipt…");
      previewChangeVersionRef.current = null;
    } catch {
      setStage("error");
      setError(
        "Fabric could not finish applying the preview. Inspect the board, then send a fresh request before retrying.",
      );
      onFinalizingChange(false);
    }
  }

  function retryApprovalConfirmation() {
    if (!pendingApproval) return;
    setError(null);
    setStage("finalizing");
    setProgress("Rechecking the saved board and durable AI receipt…");
    onFinalizingChange(true);
    setApprovalAttempt((current) => current + 1);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <aside
      id="fabric-ai-assistance-panel"
      aria-label="Fabric agent"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      className={cx(
        "absolute inset-x-2 bottom-2 z-1100 flex max-h-[calc(88dvh-1rem)] flex-col overflow-hidden rounded-radius-2xl bg-surface-white/98 opacity-100 floating-shadow ring-1 ring-near-black-primary-text/8 backdrop-blur-xl transition-[transform,opacity] duration-(--motion-panel) ease-(--ease-out-quart) motion-reduce:transition-none sm:inset-x-auto sm:top-16 sm:right-auto sm:bottom-auto sm:left-3 sm:max-h-[calc(100dvh-5rem)] sm:w-[23rem]",
        open
          ? "translate-y-0 sm:translate-x-0"
          : "pointer-events-none translate-y-[calc(100%+0.5rem)] opacity-0 sm:translate-y-0 sm:-translate-x-[calc(100%+0.75rem)]",
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-near-black-primary-text/8 px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <SparklesIcon
            className="size-4 h-lh shrink-0 fill-sky-blue-accent"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 id="fabric-ai-title" className="font-medium">Fabric agent</h2>
            <p className="text-pretty text-base text-muted-gray sm:text-sm">
              Turns the visible canvas into editable work.
            </p>
          </div>
        </div>
        <IconButton label="Close Fabric agent" tooltipSide="right" onClick={onClose}>
          <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        </IconButton>
      </header>

      <div
        ref={conversationRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        role="log"
        aria-label="Fabric agent conversation"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <ol className="flex flex-col gap-4" role="list" aria-label="AI Conversation">
          {messages.length === 0 ? (
            <li className="flex items-start gap-2.5 review-panel-enter motion-reduce:animate-none">
              <SparklesIcon
                className="size-4 h-lh shrink-0 fill-sky-blue-accent"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-medium">What should Fabric make?</p>
                <p className="text-pretty text-base text-muted-gray sm:text-sm">
                  Ask for a diagram, plan, summary, explanation, or cleaner layout. Fabric reads the visible canvas and previews every board change first.
                </p>
              </div>
            </li>
          ) : null}

          {messages.map((message) => (
            <li
              key={message.id}
              className={cx(
                "flex min-w-0 review-panel-enter motion-reduce:animate-none",
                message.role === "user" ? "justify-end" : "items-start gap-2.5",
              )}
            >
              {message.role === "assistant" ? (
                <SparklesIcon
                  className="size-4 h-lh shrink-0 fill-sky-blue-accent"
                  aria-hidden="true"
                />
              ) : null}
              <div
                className={cx(
                  "min-w-0 max-w-[88%]",
                  message.role === "user" &&
                    "rounded-radius-xl bg-light-surface-tint px-3 py-2.5 ring-1 ring-border-subtle",
                )}
              >
                <p className="text-pretty whitespace-pre-wrap text-base sm:text-sm">
                  {message.content}
                </p>
                {message.contextLabel ? (
                  <p className="pt-1 text-base text-muted-gray sm:text-sm">
                    {message.contextLabel}
                  </p>
                ) : null}
              </div>
            </li>
          ))}

          {stage === "running" || stage === "applying" || stage === "finalizing" ? (
            <li
              className="flex items-start gap-2.5 text-sky-blue-accent review-panel-enter motion-reduce:animate-none"
            >
              <span className="grid size-4 h-lh shrink-0 place-items-center" aria-hidden="true">
                <WaveSpinner
                  animation="ripple"
                  pattern="square3x3"
                  dotShape="rounded"
                  size="xs"
                  color="var(--accent)"
                />
              </span>
              <p className="min-w-0 text-pretty text-base sm:text-sm">{progress}</p>
            </li>
          ) : null}

          {proposal && stage === "preview" ? (
            <li>
              <section
                className="flex flex-col gap-3 rounded-radius-xl bg-light-surface-tint p-3.5 ring-1 ring-border-subtle review-panel-enter motion-reduce:animate-none"
                aria-label="AI Change Preview"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium">Change Preview</h3>
                    <p className="text-pretty text-base text-muted-gray sm:text-sm">
                      Review every board edit before it is applied.
                    </p>
                  </div>
                  <p className="shrink-0 rounded-radius-pill bg-surface-white px-2 py-1 text-sm font-medium text-muted-gray ring-1 ring-near-black-primary-text/8 tabular-nums">
                    {proposal.patch.operations.length} {proposal.patch.operations.length === 1 ? "change" : "changes"}
                  </p>
                </div>
                {proposal.riskClass !== "low" ? (
                  <p className="text-pretty text-base text-(--warning) sm:text-sm">
                    This proposal includes a higher-impact board edit. Review each change carefully.
                  </p>
                ) : null}
                <ol className="max-h-52 list-decimal overflow-y-auto pl-5" role="list">
                  {proposal.patch.operations.map((operation, index) => (
                    <li
                      key={`${operation.type}-${index}`}
                      className="py-1 text-base marker:font-medium marker:text-muted-gray sm:text-sm"
                    >
                      {operationLabel(operation)}
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap justify-end gap-2 border-t border-near-black-primary-text/8 pt-3">
                  <Button tone="ghost" onClick={() => void cancelProposal()}>
                    Discard
                  </Button>
                  <Button
                    tone="primary"
                    onClick={() => void applyProposal()}
                    leading={(
                      <CheckIcon
                        className="size-4 shrink-0 fill-current"
                        aria-hidden="true"
                      />
                    )}
                  >
                    Apply Changes
                  </Button>
                </div>
              </section>
            </li>
          ) : null}

          {stage === "applied" ? (
            <li className="flex items-start gap-2.5 text-sky-blue-accent review-panel-enter motion-reduce:animate-none">
              <CheckIcon className="size-4 h-lh shrink-0 fill-current" aria-hidden="true" />
              <p className="text-pretty text-base sm:text-sm">{progress}</p>
            </li>
          ) : null}

          {stage === "canceled" ? (
            <li className="flex items-start gap-2.5 text-muted-gray review-panel-enter motion-reduce:animate-none">
              <StopIcon className="size-4 h-lh shrink-0 fill-current" aria-hidden="true" />
              <p className="text-pretty text-base sm:text-sm">{progress}</p>
            </li>
          ) : null}

          {error ? (
            <li
              className={cx(
                "flex items-start gap-2.5 rounded-radius-lg px-3 py-2.5 review-panel-enter motion-reduce:animate-none",
                pendingApproval
                  ? "bg-(--warning-soft) text-(--warning)"
                  : "bg-(--danger-soft) text-(--danger)",
              )}
              data-tone={pendingApproval ? "warning" : "danger"}
            >
              <ExclamationTriangleIcon
                className="size-4 h-lh shrink-0 fill-current"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {pendingApproval ? "Save confirmation pending" : "Request needs attention"}
                </p>
                <p className="text-pretty text-base sm:text-sm">{error}</p>
                {pendingApproval ? (
                  <div className="flex justify-end pt-2">
                    <Button tone="secondary" onClick={retryApprovalConfirmation}>
                      Retry Confirmation
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ) : null}
        </ol>
      </div>

      <div className="shrink-0 border-t border-near-black-primary-text/8 bg-surface-white p-3">
        {!persistenceReady && !pendingApproval ? (
          <p
            className="pb-2 text-pretty text-base text-(--warning) sm:text-sm"
            role="status"
          >
            Fabric agent will unlock when the board and live collaboration finish syncing.
          </p>
        ) : null}

        <form
          className="rounded-radius-xl bg-light-surface-tint p-2 ring-1 ring-near-black-primary-text/10 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-sky-blue-accent"
          onSubmit={generateProposal}
        >
          <label htmlFor="fabric-ai-instruction" className="sr-only">
            Ask Fabric agent
          </label>
          <textarea
            ref={composerRef}
            id="fabric-ai-instruction"
            name="ai-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={2}
            maxLength={2_000}
            placeholder="Ask Fabric agent to write on the board…"
            disabled={composerDisabled}
            className="max-h-32 min-h-16 w-full resize-none bg-transparent p-2 text-base text-near-black-primary-text outline-none placeholder:text-muted-gray disabled:cursor-not-allowed disabled:opacity-55"
          />
          <div className="flex items-center justify-between gap-2 border-t border-near-black-primary-text/8 pt-2">
            <div className="flex min-w-0 items-center gap-1.5 px-1 text-muted-gray">
              <SparklesIcon
                className="size-4 h-lh shrink-0 fill-current"
                aria-hidden="true"
              />
              <p
                className="truncate text-base sm:text-sm"
                data-ai-model-name
              >
                Fabric agent
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {stage === "running" ? (
                <IconButton
                  label="Cancel AI Response"
                  tooltipSide="top"
                  onClick={() => void cancelProposal()}
                >
                  <StopIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
                </IconButton>
              ) : null}
              <button
                type="submit"
                aria-label="Send Message"
                disabled={composerDisabled || instruction.trim().length === 0}
                className="relative grid size-8 shrink-0 place-items-center rounded-radius-md bg-sky-blue-accent text-white outline-none ring-1 ring-sky-blue-accent active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PaperAirplaneIcon
                  className="size-4 shrink-0 fill-current"
                  aria-hidden="true"
                />
                <span
                  className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}

function operationLabel(operation: ProposalReadyPayload["patch"]["operations"][number]): string {
  if (operation.type === "createNode") return `Add ${operation.content.title}`;
  if (operation.type === "writeText") return `Write ${operation.text.slice(0, 80)}`;
  if (operation.type === "createDrawing") return "Draw a pen stroke";
  if (operation.type === "updateNode") return "Update an existing canvas object";
  if (operation.type === "moveNode") return "Reposition an existing canvas object";
  if (operation.type === "resizeNode") return "Resize an existing canvas object";
  if (operation.type === "createConnector") return "Connect two canvas objects";
  return "Remove an existing canvas object";
}

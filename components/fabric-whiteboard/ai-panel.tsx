"use client";

import {
  BoltIcon,
  CheckIcon,
  CursorArrowRaysIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
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
import type { Editor, TLShape } from "tldraw";

import { Button, IconButton, cx } from "@/components/ui";
import {
  AiProposalClientError,
  cancelAiProposal,
  finalizeAiProposal,
  streamAiProposal,
} from "@/lib/ai/client";
import type { CanvasNodeType } from "@/lib/ai/canvas-patch";
import type { ProposalReadyPayload } from "@/lib/ai/contracts";
import type { AiProposalRequest } from "@/lib/ai/proposal-request";

export type FabricWhiteboardAiAdapter = Readonly<{
  getSelection?: (editor: Editor) => AiProposalRequest["selection"];
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

const nodeTypeLabels: Record<
  CanvasNodeType,
  Readonly<{ singular: string; plural: string }>
> = {
  frame: { singular: "frame", plural: "frames" },
  note: { singular: "note", plural: "notes" },
  text: { singular: "text block", plural: "text blocks" },
  rectangle: { singular: "shape", plural: "shapes" },
  ellipse: { singular: "shape", plural: "shapes" },
  diamond: { singular: "shape", plural: "shapes" },
  triangle: { singular: "shape", plural: "shapes" },
  hexagon: { singular: "shape", plural: "shapes" },
  image: { singular: "image", plural: "images" },
  drawing: { singular: "drawing", plural: "drawings" },
  summary: { singular: "summary", plural: "summaries" },
};

function recordProps(shape: TLShape): Record<string, unknown> {
  return shape.props as unknown as Record<string, unknown>;
}

function richTextValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? record.text : "";
  const content = Array.isArray(record.content)
    ? record.content.map(richTextValue).join("")
    : "";
  return `${ownText}${content}`;
}

function shapeText(shape: TLShape): string {
  const props = recordProps(shape);
  const candidates = [props.richText, props.text, props.name, props.url];
  for (const candidate of candidates) {
    const text = richTextValue(candidate).trim();
    if (text) return text;
  }
  return "";
}

function canvasNodeType(shape: TLShape): CanvasNodeType | null {
  if (shape.type === "frame") return "frame";
  if (shape.type === "note") return "note";
  if (shape.type === "text") return "text";
  if (shape.type === "image") return "image";
  if (
    shape.type === "draw" ||
    shape.type === "highlight" ||
    shape.type === "line"
  ) return "drawing";
  if (shape.type !== "geo") return null;
  const geo = recordProps(shape).geo;
  if (geo === "ellipse" || geo === "oval") return "ellipse";
  if (geo === "diamond") return "diamond";
  if (geo === "triangle") return "triangle";
  if (geo === "hexagon") return "hexagon";
  return "rectangle";
}

function defaultAiSelection(editor: Editor): AiProposalRequest["selection"] {
  return editor
    .getSelectedShapes()
    .slice(0, 40)
    .flatMap((shape, index) => {
      const type = canvasNodeType(shape);
      const bounds = editor.getShapePageBounds(shape);
      if (!type || !bounds) return [];
      const text = shapeText(shape);
      const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const title = (lines[0] || `${type} ${index + 1}`).slice(0, 200);
      const body = lines.slice(1).join("\n").slice(0, 4_000);
      return [{
        id: shape.id,
        type,
        title,
        ...(body ? { body } : {}),
        x: clampCoordinate(bounds.x),
        y: clampCoordinate(bounds.y),
        width: clampDimension(bounds.w),
        height: clampDimension(bounds.h),
        ...(shape.isLocked ? { locked: true } : {}),
        ...(shape.parentId.startsWith("shape:") ? { parentId: shape.parentId } : {}),
      }];
    });
}

function currentAiSelection(
  editor: Editor,
  adapter: FabricWhiteboardAiAdapter,
): AiProposalRequest["selection"] {
  return adapter.getSelection?.(editor) ?? defaultAiSelection(editor);
}

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

function selectionContextLabel(
  selection: AiProposalRequest["selection"],
): Readonly<{ title: string; detail: string }> {
  if (selection.length === 0) {
    return {
      title: "No Selection",
      detail: "Fabric AI will use the visible canvas.",
    };
  }

  const counts = new Map<string, number>();
  for (const node of selection) {
    const label = nodeTypeLabels[node.type];
    const key = label.singular === "shape" ? "shape" : node.type;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const detail = [...counts.entries()]
    .map(([key, count]) => {
      const type = key === "shape"
        ? nodeTypeLabels.rectangle
        : nodeTypeLabels[key as CanvasNodeType];
      return `${count} ${count === 1 ? type.singular : type.plural}`;
    })
    .join(" · ");

  return {
    title: `${selection.length} ${selection.length === 1 ? "Object" : "Objects"} Selected`,
    detail,
  };
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
  const [selection, setSelection] = useState<AiProposalRequest["selection"]>([]);
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
  const selectionCopy = selectionContextLabel(selection);
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
    if (!open || !editor) return;
    const refreshSelection = () => {
      setSelection(currentAiSelection(editor, adapter));
    };
    refreshSelection();
    return editor.store.listen(refreshSelection, { scope: "session" });
  }, [adapter, editor, open]);

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
        if (
          !persistenceReadyRef.current ||
          observedDurableSequence <= baseDurableSequence
        ) {
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

    const selectionSnapshot = currentAiSelection(editor, adapter);
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
        selectionSnapshot.length === 0
          ? "Visible canvas"
          : `${selectionSnapshot.length} selected`,
      ),
    ));
    setInstruction("");
    setSelection(selectionSnapshot);
    setStage("running");
    setProgress("Reading the board and preparing changes…");
    setProposal(null);
    setPendingApproval(null);
    setError(null);
    runIdRef.current = null;

    try {
      const nextProposal = await streamAiProposal({
        request: {
          skill: "canvas-agent",
          boardId,
          workspaceId,
          documentGenerationId,
          durableSequence,
          instruction: nextInstruction,
          selection: selectionSnapshot,
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
      if (readChangeVersion() !== startChangeVersion) {
        setStage("error");
        setError(
          "The board changed while Fabric AI was working. Review the board and send your request again.",
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
      setSelection(selectionSnapshot);
    } catch (caught) {
      if (controller.signal.aborted) {
        setStage("canceled");
        setProgress("Request canceled.");
      } else {
        const message = caught instanceof AiProposalClientError
          ? caught.message
          : "Fabric AI could not prepare a preview. Check your connection and send the request again.";
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
      aria-label="Fabric AI"
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      className={cx(
        "absolute inset-x-0 bottom-0 z-1100 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-radius-xl bg-surface-white opacity-100 floating-shadow ring-1 ring-near-black-primary-text/8 transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none sm:inset-y-0 sm:right-auto sm:left-0 sm:max-h-none sm:w-[25rem] sm:rounded-none",
        open
          ? "translate-y-0 sm:translate-x-0"
          : "pointer-events-none translate-y-full opacity-0 sm:translate-y-0 sm:-translate-x-full",
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-near-black-primary-text/8 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <SparklesIcon
            className="size-4 h-lh shrink-0 fill-sky-blue-accent"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="font-medium">Fabric AI</h2>
            <p className="text-pretty text-base text-muted-gray sm:text-sm">
              Writes and organizes directly on your board.
            </p>
          </div>
        </div>
        <IconButton label="Close Fabric AI" tooltipSide="right" onClick={onClose}>
          <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        </IconButton>
      </header>

      <div
        ref={conversationRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
      >
        <ol className="flex flex-col gap-5" role="list" aria-label="AI Conversation">
          {messages.length === 0 ? (
            <li className="flex items-start gap-2.5">
              <SparklesIcon
                className="size-4 h-lh shrink-0 fill-sky-blue-accent"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-medium">What should I add to the board?</p>
                <p className="text-pretty text-base text-muted-gray sm:text-sm">
                  Ask me to write, organize, connect, or refine your ideas. Select objects for a focused change, or leave everything unselected to use the visible canvas.
                </p>
              </div>
            </li>
          ) : null}

          {messages.map((message) => (
            <li
              key={message.id}
              className={cx(
                "flex min-w-0",
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
              className="flex items-start gap-2.5 text-sky-blue-accent"
              role="status"
              aria-live="polite"
            >
              <BoltIcon
                className="size-4 h-lh shrink-0 animate-pulse fill-current motion-reduce:animate-none"
                aria-hidden="true"
              />
              <p className="min-w-0 text-pretty text-base sm:text-sm">{progress}</p>
            </li>
          ) : null}

          {proposal && stage === "preview" ? (
            <li>
              <section
                className="flex flex-col gap-3 rounded-radius-xl bg-light-surface-tint p-3.5 ring-1 ring-border-subtle"
                aria-label="AI Change Preview"
                aria-live="polite"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium">Change Preview</h3>
                    <p className="text-pretty text-base text-muted-gray sm:text-sm">
                      Review every board edit before it is applied.
                    </p>
                  </div>
                  <p className="shrink-0 rounded-radius-pill bg-surface-white px-2 py-1 text-sm font-medium text-muted-gray ring-1 ring-near-black-primary-text/8">
                    {proposal.riskClass === "low" ? "Low" : "Elevated"} Risk
                  </p>
                </div>
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
            <li className="flex items-start gap-2.5 text-sky-blue-accent" role="status">
              <CheckIcon className="size-4 h-lh shrink-0 fill-current" aria-hidden="true" />
              <p className="text-pretty text-base sm:text-sm">{progress}</p>
            </li>
          ) : null}

          {stage === "canceled" ? (
            <li className="flex items-start gap-2.5 text-muted-gray" role="status">
              <StopIcon className="size-4 h-lh shrink-0 fill-current" aria-hidden="true" />
              <p className="text-pretty text-base sm:text-sm">{progress}</p>
            </li>
          ) : null}

          {error ? (
            <li
              className="flex items-start gap-2.5 rounded-radius-lg bg-(--danger-soft) p-3 text-(--danger)"
              role="alert"
            >
              <ExclamationTriangleIcon
                className="size-4 h-lh shrink-0 fill-current"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
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
        <div className="flex min-w-0 items-start gap-2 px-1 pb-2" aria-live="polite">
          <CursorArrowRaysIcon
            className="size-4 h-lh shrink-0 fill-sky-blue-accent"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-medium">{selectionCopy.title}</p>
            <p className="truncate text-base text-muted-gray sm:text-sm">
              {selectionCopy.detail}
            </p>
          </div>
        </div>

        {!persistenceReady && !pendingApproval ? (
          <p
            className="pb-2 text-pretty text-base text-(--warning) sm:text-sm"
            role="status"
          >
            Fabric AI will unlock when the board and live collaboration finish syncing.
          </p>
        ) : null}

        <form
          className="rounded-radius-xl bg-light-surface-tint p-2 ring-1 ring-near-black-primary-text/10 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-sky-blue-accent"
          onSubmit={generateProposal}
        >
          <label htmlFor="fabric-ai-instruction" className="sr-only">
            Ask Fabric AI
          </label>
          <textarea
            ref={composerRef}
            id="fabric-ai-instruction"
            name="ai-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            rows={3}
            maxLength={2_000}
            placeholder="Ask Fabric AI to write on the board…"
            disabled={composerDisabled}
            className="max-h-40 min-h-20 w-full resize-none bg-transparent p-2 text-base text-near-black-primary-text outline-none placeholder:text-muted-gray disabled:cursor-not-allowed disabled:opacity-55"
          />
          <div className="flex items-center justify-between gap-2 border-t border-near-black-primary-text/8 pt-2">
            <div className="flex min-w-0 items-center gap-1.5 px-1 text-muted-gray">
              <PencilSquareIcon
                className="size-4 h-lh shrink-0 fill-current"
                aria-hidden="true"
              />
              <p className="truncate text-base sm:text-sm">Canvas Agent</p>
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
  if (operation.type === "createNode") return `Create ${operation.nodeType}: ${operation.content.title}`;
  if (operation.type === "writeText") return `Write with the pen: ${operation.text}`;
  if (operation.type === "createDrawing") return "Draw a pen stroke";
  if (operation.type === "updateNode") return `Update ${operation.nodeId}`;
  if (operation.type === "moveNode") return `Move ${operation.nodeId}`;
  if (operation.type === "resizeNode") return `Resize ${operation.nodeId}`;
  if (operation.type === "createConnector") return `Connect ${operation.sourceId} to ${operation.targetId}`;
  return `Delete ${operation.nodeId}`;
}

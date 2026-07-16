"use client";

import {
  BoltIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Editor, TLShape } from "tldraw";

import { Button, IconButton } from "@/components/ui";
import {
  AiProposalClientError,
  cancelAiProposal,
  finalizeAiProposal,
  streamAiProposal,
} from "@/lib/ai/client";
import type { CanvasNodeType } from "@/lib/ai/canvas-patch";
import type { ProposalReadyPayload } from "@/lib/ai/contracts";
import type { AiProposalRequest } from "@/lib/ai/proposal-request";

export type FabricAssistanceMode = "off" | "feedback" | "suggest" | "solve";
type ActiveAssistanceMode = Exclude<FabricAssistanceMode, "off">;

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

const modeInstructions: Record<ActiveAssistanceMode, string> = {
  feedback:
    "Review the selected objects, preserve their evidence, and cluster them to expose unclear or contradictory themes.",
  suggest:
    "Cluster the selected objects into clear themes and suggest a legible spatial organization without deleting evidence.",
  solve:
    "Turn the selected objects into a decision-ready synthesis with clear themes, hierarchy, and connections while preserving every source object.",
};

const modeCopy: Record<ActiveAssistanceMode, Readonly<{
  title: string;
  subtitle: string;
  minimumSelection: 1 | 2;
  selectionHelp: string;
  selectionError: string;
  ready: string;
  preparing: string;
  building: string;
  previewReady: string;
  previewTitle: string;
  generate: string;
  generating: string;
  apply: string;
  applied: string;
}>> = {
  feedback: {
    title: "Feedback",
    subtitle: "Preview a focused review, then choose what to apply.",
    minimumSelection: 1,
    selectionHelp: "Select 1–40 notes, text blocks, frames, images, or shapes. Feedback stays in preview until you apply it.",
    selectionError: "Select at least one supported object before generating feedback.",
    ready: "Ready to review selected objects.",
    preparing: "Preparing the selected evidence…",
    building: "Drafting a feedback preview…",
    previewReady: "Feedback preview ready for review.",
    previewTitle: "Feedback Preview",
    generate: "Generate Feedback",
    generating: "Reviewing…",
    apply: "Apply Feedback Notes",
    applied: "Feedback applied and durably confirmed.",
  },
  suggest: {
    title: "Suggest",
    subtitle: "Preview a clearer structure, then choose what to apply.",
    minimumSelection: 2,
    selectionHelp: "Select 2–40 notes, text blocks, frames, images, or shapes. Suggestions stay in preview until you apply them.",
    selectionError: "Select at least two supported objects before generating suggestions.",
    ready: "Ready to suggest a clearer structure.",
    preparing: "Preparing the selected objects…",
    building: "Building a suggestion preview…",
    previewReady: "Suggestion preview ready for review.",
    previewTitle: "Suggestion Preview",
    generate: "Generate Suggestions",
    generating: "Generating…",
    apply: "Apply Suggestions",
    applied: "Suggestions applied and durably confirmed.",
  },
  solve: {
    title: "Solve",
    subtitle: "Preview a decision-ready synthesis, then choose what to apply.",
    minimumSelection: 2,
    selectionHelp: "Select 2–40 notes, text blocks, frames, images, or shapes. The solution stays in preview until you apply it.",
    selectionError: "Select at least two supported objects before generating a solution.",
    ready: "Ready to synthesize a decision-ready solution.",
    preparing: "Preparing the selected evidence…",
    building: "Synthesizing a solution preview…",
    previewReady: "Solution preview ready for review.",
    previewTitle: "Solution Preview",
    generate: "Generate Solution",
    generating: "Solving…",
    apply: "Apply Solution",
    applied: "Solution applied and durably confirmed.",
  },
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
  if (shape.type !== "geo") return null;
  const geo = recordProps(shape).geo;
  return geo === "ellipse" || geo === "oval" ? "ellipse" : "rectangle";
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
        x: Math.max(-100_000, Math.min(100_000, bounds.x)),
        y: Math.max(-100_000, Math.min(100_000, bounds.y)),
        width: Math.max(24, Math.min(10_000, bounds.w)),
        height: Math.max(24, Math.min(10_000, bounds.h)),
        ...(shape.isLocked ? { locked: true } : {}),
        ...(shape.parentId.startsWith("shape:") ? { parentId: shape.parentId } : {}),
      }];
    });
}

export function FabricAiPanel({
  editor,
  mode,
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
  mode: ActiveAssistanceMode;
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
  const copy = modeCopy[mode];
  const [instruction, setInstruction] = useState(modeInstructions[mode]);
  const [stage, setStage] = useState<AiStage>("idle");
  const [progress, setProgress] = useState(copy.ready);
  const [proposal, setProposal] = useState<ProposalReadyPayload | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [approvalAttempt, setApprovalAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const previewChangeVersionRef = useRef<number | null>(null);
  const durableSequenceRef = useRef(durableSequence);
  const persistenceReadyRef = useRef(persistenceReady);

  useEffect(() => {
    durableSequenceRef.current = durableSequence;
    persistenceReadyRef.current = persistenceReady;
  }, [durableSequence, persistenceReady]);

  useEffect(() => () => {
    const activeController = abortRef.current;
    abortRef.current = null;
    activeController?.abort();
    const activeRunId = runIdRef.current;
    runIdRef.current = null;
    if (activeRunId && !activeController) {
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
          setProgress(copy.applied);
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
              ? `${caught.message} The board change remains applied; retry confirmation after sync completes.`
              : "The board change was applied, but Fabric could not confirm its durable AI receipt.",
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
  }, [approvalAttempt, copy.applied, onFinalizingChange, pendingApproval, stage]);

  async function generateProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !editor ||
      stage === "running" ||
      stage === "applying" ||
      stage === "finalizing" ||
      pendingApproval
    ) return;
    if (!persistenceReady) {
      setStage("error");
      setError("Wait for the board to finish syncing before generating an AI proposal.");
      return;
    }
    const selection = adapter.getSelection?.(editor) ?? defaultAiSelection(editor);
    if (selection.length < copy.minimumSelection) {
      setStage("error");
      setError(copy.selectionError);
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const startChangeVersion = readChangeVersion();
    setStage("running");
    setProgress(copy.preparing);
    setProposal(null);
    setPendingApproval(null);
    setError(null);
    runIdRef.current = null;

    try {
      const nextProposal = await streamAiProposal({
        request: {
          skill: "cluster-by-theme",
          mode,
          boardId,
          workspaceId,
          documentGenerationId,
          durableSequence,
          instruction: instruction.trim(),
          selection,
        },
        signal: controller.signal,
        onRunId: (runId) => {
          runIdRef.current = runId;
        },
        onEvent: (event) => {
          if (event.type === "run.progress") {
            const payload = event.payload as { message: string };
            setProgress(payload.message);
          } else if (event.type === "proposal.delta") {
            setProgress(copy.building);
          }
        },
      });
      if (readChangeVersion() !== startChangeVersion) {
        setStage("error");
        setError("The board changed while Fabric was working. Review the new selection and generate again.");
        return;
      }
      previewChangeVersionRef.current = startChangeVersion;
      setProposal(nextProposal);
      setStage("preview");
      setProgress(copy.previewReady);
    } catch (caught) {
      if (controller.signal.aborted) {
        setStage("canceled");
        setProgress("Proposal canceled.");
      } else {
        const message = caught instanceof AiProposalClientError
          ? caught.message
          : "Fabric could not prepare a proposal. Check your connection and try again.";
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
    setProgress("Proposal canceled.");
    setError(null);
    previewChangeVersionRef.current = null;
    if (!runId) return;
    try {
      await cancelAiProposal(runId);
    } catch {
      setStage("error");
      setError(
        "Fabric closed this preview, but could not confirm cancellation with the AI worker. It will expire without being applied.",
      );
    }
  }

  async function applyProposal() {
    if (!editor || !proposal || stage !== "preview") return;
    if (previewChangeVersionRef.current !== readChangeVersion()) {
      setStage("error");
      setError("The board changed after this preview was created. Generate a fresh proposal before applying it.");
      setProposal(null);
      return;
    }
    if (
      proposal.patch.base.documentGenerationId !== documentGenerationId ||
      proposal.patch.base.durableSequence !== durableSequence
    ) {
      setStage("error");
      setError("This preview targets an older board version. Generate a fresh proposal before applying it.");
      setProposal(null);
      return;
    }

    setStage("applying");
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
      setProgress("Saving the approved proposal and confirming its durable receipt.");
      previewChangeVersionRef.current = null;
    } catch {
      setStage("error");
      setError("Fabric could not finish applying the proposal. Inspect the board, then generate a fresh preview before retrying.");
      onFinalizingChange(false);
    }
  }

  function retryApprovalConfirmation() {
    if (!pendingApproval) return;
    setError(null);
    setStage("finalizing");
    setProgress("Rechecking the saved board and durable AI receipt.");
    onFinalizingChange(true);
    setApprovalAttempt((current) => current + 1);
  }

  if (!open) return null;

  return (
    <aside
      id="fabric-ai-assistance-panel"
      aria-label="Fabric AI Assistance"
      className="absolute inset-x-2 bottom-2 z-1000 flex max-h-[68dvh] flex-col overflow-hidden rounded-radius-xl bg-surface-white floating-shadow sm:inset-x-auto sm:top-16 sm:right-3 sm:bottom-3 sm:w-[23rem] sm:max-h-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-near-black-primary-text/8 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <SparklesIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-medium">{copy.title}</h2>
            <p className="text-pretty text-base text-muted-gray sm:text-sm">{copy.subtitle}</p>
          </div>
        </div>
        <IconButton
          label="Close AI Assistance"
          disabled={stage === "running" || stage === "applying" || stage === "finalizing"}
          onClick={onClose}
        >
          <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <form className="flex flex-col gap-3" onSubmit={generateProposal}>
          <label htmlFor="fabric-ai-instruction" className="font-medium">Instructions</label>
          <textarea
            id="fabric-ai-instruction"
            name="ai-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={5}
            maxLength={2_000}
            disabled={stage === "running" || stage === "applying"}
            className="min-h-28 resize-y rounded-radius-md bg-surface-white p-2.5 text-base outline-none ring-1 ring-near-black-primary-text/10 placeholder:text-muted-gray focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent disabled:bg-light-surface-tint disabled:text-muted-gray sm:text-sm"
          />
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            {copy.selectionHelp}
          </p>
          {!persistenceReady && !pendingApproval ? (
            <p className="rounded-radius-md bg-(--warning-soft) p-3 text-base text-(--warning) sm:text-sm" role="status">
              AI preview will unlock when the board and live collaboration are fully synced.
            </p>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-radius-md bg-(--danger-soft) p-3 text-(--danger)" role="alert">
              <ExclamationTriangleIcon className="size-4 h-lh shrink-0 fill-current" aria-hidden="true" />
              <p className="text-pretty text-base sm:text-sm">{error}</p>
            </div>
          ) : null}

          {stage === "running" || stage === "applying" || stage === "finalizing" ? (
            <div className="flex items-start gap-2 rounded-radius-md bg-(--accent-soft) p-3 text-sky-blue-accent" role="status" aria-live="polite">
              <BoltIcon className="size-4 h-lh shrink-0 animate-pulse fill-current motion-reduce:animate-none" aria-hidden="true" />
              <p className="text-pretty text-base sm:text-sm">
                {stage === "applying" ? "Applying the approved proposal…" : progress}
              </p>
            </div>
          ) : null}

          {proposal && stage === "preview" ? (
            <section className="flex flex-col gap-3 rounded-radius-lg bg-light-surface-tint p-4" aria-live="polite">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium">{copy.previewTitle}</h3>
                  <p className="text-pretty text-base text-muted-gray sm:text-sm">{proposal.patch.summary}</p>
                </div>
                <div className="shrink-0 rounded-radius-pill bg-surface-white px-2 py-1 text-[0.75rem] font-medium text-muted-gray ring-1 ring-near-black-primary-text/8">
                  {proposal.riskClass} risk
                </div>
              </div>
              <ol className="flex max-h-56 flex-col gap-2 overflow-y-auto" role="list">
                {proposal.patch.operations.map((operation, index) => (
                  <li key={`${operation.type}-${index}`} className="flex items-start gap-2 text-base sm:text-sm">
                    <div className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-white text-[0.6875rem] font-medium tabular-nums text-sky-blue-accent ring-1 ring-near-black-primary-text/8">
                      {index + 1}
                    </div>
                    <span>{operationLabel(operation)}</span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap justify-end gap-2">
                <Button tone="ghost" onClick={() => void cancelProposal()}>Discard Preview</Button>
                <Button
                  tone="primary"
                  onClick={() => void applyProposal()}
                  leading={<CheckIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
                >
                  {copy.apply}
                </Button>
              </div>
            </section>
          ) : pendingApproval ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                tone="primary"
                disabled={stage !== "error"}
                onClick={retryApprovalConfirmation}
              >
                Retry Confirmation
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {stage === "running" ? (
                <Button tone="ghost" onClick={() => void cancelProposal()}>Cancel Proposal</Button>
              ) : null}
              <Button
                type="submit"
                tone="primary"
                disabled={!editor || !persistenceReady || instruction.trim().length === 0 || stage === "running" || stage === "applying" || stage === "finalizing"}
                leading={<SparklesIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
              >
                {stage === "running" ? copy.generating : copy.generate}
              </Button>
            </div>
          )}
        </form>
      </div>
    </aside>
  );
}

function operationLabel(operation: ProposalReadyPayload["patch"]["operations"][number]): string {
  if (operation.type === "createNode") return `Create ${operation.nodeType}: ${operation.content.title}`;
  if (operation.type === "updateNode") return `Update ${operation.nodeId}`;
  if (operation.type === "moveNode") return `Move ${operation.nodeId}`;
  if (operation.type === "resizeNode") return `Resize ${operation.nodeId}`;
  if (operation.type === "createConnector") return `Connect ${operation.sourceId} to ${operation.targetId}`;
  return `Delete ${operation.nodeId}`;
}

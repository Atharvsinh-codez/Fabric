"use client";

import { SparklesIcon } from "@heroicons/react/16/solid";

import { cx } from "@/components/ui";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import type { BoardSyncState } from "@/lib/boards/use-board-document";

const syncLabels: Record<BoardSyncState, string> = {
  synced: "Saved",
  saving: "Syncing…",
  offline: "Offline",
  conflict: "Save Conflict",
  error: "Save Needs Attention",
};

export function boardSyncLabel(state: BoardSyncState): string {
  return syncLabels[state];
}

export function shouldOpenSyncRecoveryOnLeave(state: BoardSyncState): boolean {
  return state === "offline" || state === "conflict" || state === "error";
}

export function FabricAiTrigger({
  panelOpen,
  busy,
  disabled,
  onClick,
}: {
  panelOpen: boolean;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={panelOpen ? "Close Fabric agent" : "Open Fabric agent"}
      aria-controls="fabric-ai-assistance-panel"
      aria-expanded={panelOpen}
      aria-pressed={panelOpen}
      aria-busy={busy}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "relative flex h-8 shrink-0 items-center gap-1.5 rounded-radius-md py-1.5 pr-2.5 pl-1.5 text-base font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm",
        panelOpen
          ? "bg-(--accent-soft) text-sky-blue-accent"
          : "text-muted-gray hover:bg-light-surface-tint hover:text-near-black-primary-text active:bg-light-surface-tint",
      )}
    >
      {busy ? (
        <span className="grid size-4 h-lh shrink-0 place-items-center" aria-hidden="true">
          <WaveSpinner
            animation="ripple"
            pattern="square3x3"
            dotShape="rounded"
            size="xs"
            color="currentColor"
          />
        </span>
      ) : (
        <SparklesIcon
          className="size-4 h-lh shrink-0 fill-current"
          aria-hidden="true"
        />
      )}
      <span>AI</span>
      <span
        className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
    </button>
  );
}

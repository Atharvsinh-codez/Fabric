"use client";

import {
  CloudIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import { useEffect, useState } from "react";

import type { FabricAssistanceMode } from "@/components/fabric-whiteboard/ai-panel";
import { IconButton, cx } from "@/components/ui";
import type { BoardSyncState } from "@/lib/boards/use-board-document";

const SYNC_NOTICE_DURATION_MS = 6_000;

const assistanceModes = [
  {
    value: "off",
    label: "Off",
    accessibleLabel: "Turn Off AI Assistance",
  },
  {
    value: "feedback",
    label: "Feedback",
    accessibleLabel: "Open Feedback Assistance",
  },
  {
    value: "suggest",
    label: "Suggest",
    accessibleLabel: "Open Suggest Assistance",
  },
  {
    value: "solve",
    label: "Solve",
    accessibleLabel: "Open Solve Assistance",
  },
] as const satisfies ReadonlyArray<{
  value: FabricAssistanceMode;
  label: string;
  accessibleLabel: string;
}>;

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

export function FabricAssistanceModePicker({
  mode,
  panelOpen,
  busy,
  canEdit,
  onModeChange,
}: {
  mode: FabricAssistanceMode;
  panelOpen: boolean;
  busy: boolean;
  canEdit: boolean;
  onModeChange: (mode: FabricAssistanceMode) => void;
}) {
  return (
    <nav
      className="flex max-w-full items-center gap-1 overflow-x-auto rounded-radius-lg bg-surface-white p-1 floating-shadow"
      aria-label="AI Assistance Mode"
    >
      {assistanceModes.map((option) => {
        const selected = mode === option.value;
        const opensPanel = option.value !== "off";
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.accessibleLabel}
            aria-pressed={selected}
            aria-controls={opensPanel ? "fabric-ai-assistance-panel" : undefined}
            aria-expanded={opensPanel ? selected && panelOpen : undefined}
            disabled={(busy && option.value !== mode) || (!canEdit && opensPanel)}
            onClick={() => onModeChange(option.value)}
            className={cx(
              "relative h-8 shrink-0 rounded-radius-md px-2.5 text-base font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm",
              selected && option.value === "off" &&
                "bg-light-surface-tint text-near-black-primary-text",
              selected && option.value !== "off" &&
                "bg-(--accent-soft) text-sky-blue-accent",
              !selected &&
                "text-muted-gray hover:bg-light-surface-tint hover:text-near-black-primary-text",
            )}
          >
            {option.label}
            <span
              className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
              aria-hidden="true"
            />
          </button>
        );
      })}
    </nav>
  );
}

export function FabricSyncStatus({
  state,
  onOpenRecovery,
}: {
  state: BoardSyncState;
  onOpenRecovery: () => void;
}) {
  if (state === "saving" || state === "synced") return null;

  const icon = state === "offline"
    ? <CloudIcon className="size-4 shrink-0 fill-(--warning)" aria-hidden="true" />
    : <ExclamationTriangleIcon className="size-4 shrink-0 fill-(--danger)" aria-hidden="true" />;

  return (
    <button
      type="button"
      className="relative flex h-8 min-w-8 items-center gap-1.5 rounded-radius-md px-2 text-base font-medium text-muted-gray outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:min-w-[5.25rem] sm:text-sm"
      aria-label={`${syncLabels[state]}. Open Save Recovery`}
      data-sync-state={state}
      onClick={onOpenRecovery}
    >
      {icon}
      <span className="hidden sm:inline">{syncLabels[state]}</span>
      <span
        className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
    </button>
  );
}

export function FabricSyncNotice({
  state,
  message,
  onOpenRecovery,
}: {
  state: BoardSyncState;
  message: string | null;
  onOpenRecovery: () => void;
}) {
  if (!isActionableSyncState(state)) return null;
  const relevantMessage = friendlySyncMessage(state, message);

  return (
    <TimedSyncNotice
      key={`${state}:${relevantMessage}`}
      state={state}
      message={relevantMessage}
      onOpenRecovery={onOpenRecovery}
    />
  );
}

function TimedSyncNotice({
  state,
  message,
  onOpenRecovery,
}: {
  state: Extract<BoardSyncState, "offline" | "conflict" | "error">;
  message: string;
  onOpenRecovery: () => void;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setVisible(false);
    }, SYNC_NOTICE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  const icon = state === "offline"
    ? <CloudIcon className="size-4 h-lh shrink-0 fill-(--warning)" aria-hidden="true" />
    : <ExclamationTriangleIcon className="size-4 h-lh shrink-0 fill-(--danger)" aria-hidden="true" />;

  return (
    <aside
      className="pointer-events-auto absolute inset-x-2 bottom-20 z-900 flex items-start gap-2.5 rounded-radius-lg bg-surface-white p-3 floating-shadow ring-1 ring-near-black-primary-text/5 sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-[22rem]"
      aria-label="Board Sync Notice"
      role={state === "offline" ? "status" : "alert"}
      aria-live={state === "offline" ? "polite" : "assertive"}
      aria-atomic="true"
    >
      {icon}
      <p className="min-w-0 flex-1 text-pretty text-base text-muted-gray sm:text-sm">
        {message}
      </p>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className="relative h-8 rounded-radius-md px-2 text-base font-medium text-sky-blue-accent outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:text-sm"
          onClick={() => {
            setVisible(false);
            onOpenRecovery();
          }}
        >
          Review Sync
          <span
            className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </button>
        <IconButton
          label="Dismiss Sync Notice"
          tooltipSide="top"
          onClick={() => setVisible(false)}
        >
          <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        </IconButton>
      </div>
    </aside>
  );
}

function isActionableSyncState(
  state: BoardSyncState,
): state is Extract<BoardSyncState, "offline" | "conflict" | "error"> {
  return state === "offline" || state === "conflict" || state === "error";
}

function friendlySyncMessage(
  state: Extract<BoardSyncState, "offline" | "conflict" | "error">,
  message: string | null,
): string {
  if (state === "offline") {
    return "Live collaboration is offline. Your work remains on this device while Fabric reconnects.";
  }
  return message ?? "Fabric could not finish saving this board. Review the available recovery options.";
}

"use client";

import {
  ArrowPathIcon,
  BookmarkSquareIcon,
  CheckIcon,
  ClockIcon,
} from "@heroicons/react/16/solid";
import { useState, type FormEvent } from "react";

import { FabricDialog } from "@/components/fabric-whiteboard/fabric-dialog";
import { Button } from "@/components/ui";
import { useBoardCheckpoints } from "@/lib/boards/use-board-checkpoints";

function formatCheckpointDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function FabricCheckpointDialog({
  boardId,
  canEdit,
  isSynced,
  open,
  onClose,
  onRestored,
}: {
  boardId: string;
  canEdit: boolean;
  isSynced: boolean;
  open: boolean;
  onClose: () => void;
  onRestored: () => void | Promise<void>;
}) {
  const state = useBoardCheckpoints(boardId, open);
  const [name, setName] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [restoredName, setRestoredName] = useState<string | null>(null);

  async function createCheckpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checkpointName = name.trim();
    if (!checkpointName || !canEdit || !isSynced) return;
    try {
      await state.createCheckpoint(checkpointName);
      setName("");
    } catch {
      // The hook exposes the safe server error below.
    }
  }

  async function restoreCheckpoint(checkpointId: string, checkpointName: string) {
    if (!canEdit || !isSynced) return;
    try {
      await state.restoreCheckpoint(checkpointId);
      setConfirmingId(null);
      setRestoredName(checkpointName);
      await onRestored();
      onClose();
    } catch {
      // The hook exposes the safe server error below.
    }
  }

  return (
    <FabricDialog
      open={open}
      title="Board Checkpoints"
      description="Save named recovery points and restore them as a new document generation."
      onClose={() => {
        setConfirmingId(null);
        setRestoredName(null);
        onClose();
      }}
    >
      <div className="flex flex-col gap-5">
        {!isSynced ? (
          <p className="rounded-radius-md bg-(--warning-soft) p-3 text-base text-(--warning) sm:text-sm" role="status">
            Wait for the current board to finish syncing before creating or restoring a checkpoint.
          </p>
        ) : null}

        {canEdit ? (
          <form className="flex flex-col gap-2" onSubmit={createCheckpoint}>
            <label htmlFor="fabric-checkpoint-name" className="font-medium">
              New Checkpoint
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="fabric-checkpoint-name"
                name="checkpoint-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Before homepage synthesis"
                maxLength={80}
                disabled={state.creating || !isSynced}
                className="h-10 min-w-0 flex-1 rounded-radius-md bg-surface-white px-2.5 text-base outline-none ring-1 ring-near-black-primary-text/10 placeholder:text-muted-gray focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent disabled:bg-light-surface-tint disabled:text-muted-gray sm:h-9 sm:text-sm"
              />
              <Button
                type="submit"
                tone="primary"
                disabled={!name.trim() || state.creating || !isSynced}
                leading={<BookmarkSquareIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
              >
                {state.creating ? "Saving…" : "Save Checkpoint"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            You can review saved checkpoints. Owners and editors can create or restore them.
          </p>
        )}

        {state.error ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-radius-md bg-(--danger-soft) p-3 text-(--danger)" role="alert">
            <p className="text-pretty text-base sm:text-sm">{state.error}</p>
            <Button tone="ghost" onClick={() => void state.retry()}>Retry</Button>
          </div>
        ) : null}

        {restoredName ? (
          <p className="flex items-start gap-2 rounded-radius-md bg-(--success-soft) p-3 text-(--success)" role="status">
            <CheckIcon className="size-4 h-lh shrink-0 fill-current" aria-hidden="true" />
            Restored {restoredName}.
          </p>
        ) : null}

        <section className="flex flex-col gap-3 border-t border-near-black-primary-text/8 pt-5">
          <div>
            <h3 className="font-medium">Saved History</h3>
            <p className="text-pretty text-base text-muted-gray sm:text-sm">
              Restoring replaces the current board and reconnects everyone to the restored generation.
            </p>
          </div>

          {state.loading ? (
            <p className="flex items-center gap-2 text-base text-muted-gray sm:text-sm" role="status">
              <ArrowPathIcon className="size-4 shrink-0 animate-spin fill-current motion-reduce:animate-none" aria-hidden="true" />
              Loading checkpoints…
            </p>
          ) : state.checkpoints.length === 0 ? (
            <div className="rounded-radius-lg bg-light-surface-tint p-4">
              <ClockIcon className="mb-3 size-4 fill-sky-blue-accent" aria-hidden="true" />
              <p className="font-medium">No checkpoints yet</p>
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                Save one before a major AI synthesis or structural edit.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col" role="list">
              {state.checkpoints.map((checkpoint) => {
                const confirming = confirmingId === checkpoint.id;
                const restoring = state.restoringId === checkpoint.id;
                return (
                  <li
                    key={checkpoint.id}
                    className="flex flex-col gap-3 border-t border-near-black-primary-text/8 py-3 first:border-t-0 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{checkpoint.name}</p>
                        <p className="text-base text-muted-gray sm:text-sm">
                          Revision {checkpoint.sourceRevision} · {formatCheckpointDate(checkpoint.createdAt)}
                        </p>
                        <p className="truncate text-base text-muted-gray sm:text-sm">
                          {checkpoint.creatorName ?? "Fabric member"}
                        </p>
                      </div>
                      {canEdit && !confirming ? (
                        <Button
                          tone="ghost"
                          disabled={!isSynced || state.restoringId !== null}
                          onClick={() => setConfirmingId(checkpoint.id)}
                        >
                          Restore
                        </Button>
                      ) : null}
                    </div>

                    {confirming ? (
                      <div className="rounded-radius-md bg-(--warning-soft) p-3">
                        <p className="text-pretty text-base text-(--warning) sm:text-sm">
                          Restore this checkpoint? Current board content will be replaced, while this checkpoint remains saved.
                        </p>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <Button
                            tone="ghost"
                            disabled={restoring}
                            onClick={() => setConfirmingId(null)}
                          >
                            Keep Current Board
                          </Button>
                          <Button
                            tone="primary"
                            disabled={restoring || !isSynced}
                            onClick={() => void restoreCheckpoint(checkpoint.id, checkpoint.name)}
                          >
                            {restoring ? "Restoring…" : "Confirm Restore"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </FabricDialog>
  );
}

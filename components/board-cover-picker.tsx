"use client";

import { useId, useState } from "react";

import {
  listBoardImageAssets,
  updateBoardMetadata,
  type BoardImageAssetSummary,
  type BoardSummary,
} from "@/lib/boards/client";

export function BoardCoverPicker({
  board,
  disabled = false,
  onUpdated,
  onError,
}: {
  board: BoardSummary;
  disabled?: boolean;
  onUpdated: (board: BoardSummary) => void;
  onError: (message: string) => void;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<BoardImageAssetSummary[] | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [saving, setSaving] = useState(false);

  const loadAssets = async () => {
    if (loadState === "loading" || assets) return;
    setLoadState("loading");
    try {
      setAssets(await listBoardImageAssets(board.id));
      setLoadState("idle");
    } catch (error) {
      setLoadState("error");
      onError(
        error instanceof Error
          ? error.message
          : "Board images could not be loaded.",
      );
    }
  };

  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) void loadAssets();
  };

  const chooseCover = async (assetId: string | null) => {
    setSaving(true);
    try {
      const updated = await updateBoardMetadata({
        boardId: board.id,
        cover: assetId ? { kind: "asset", assetId } : null,
      });
      onUpdated(updated);
      setOpen(false);
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "The board cover could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        disabled={disabled || saving}
        onClick={toggle}
        className="relative min-h-11 rounded-radius-md px-2.5 text-base font-medium text-muted-gray outline-none hover:bg-light-surface-tint hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent disabled:opacity-45 sm:min-h-8 sm:text-sm"
      >
        {saving ? "Saving…" : "Cover"}
        <span
          className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Choose a cover for ${board.title}`}
          className="floating-shadow mt-2 w-[min(16rem,calc(100vw-3rem))] rounded-radius-xl bg-surface-white p-3 ring-1 ring-near-black-primary-text/10"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Board cover</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-radius-sm px-1.5 py-1 text-xs font-medium text-muted-gray outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-sky-blue-accent"
            >
              Close
            </button>
          </div>

          {loadState === "loading" && (
            <p role="status" className="py-5 text-sm text-muted-gray">
              Loading board images…
            </p>
          )}
          {loadState === "error" && (
            <button
              type="button"
              onClick={() => void loadAssets()}
              className="my-3 rounded-radius-md px-2 py-1.5 text-sm font-medium ring-1 ring-border-subtle outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent"
            >
              Try loading again
            </button>
          )}
          {assets?.length === 0 && (
            <p className="py-4 text-sm text-muted-gray">
              Add an image to this board first.
            </p>
          )}
          {assets && assets.length > 0 && (
            <ul
              role="list"
              className="mt-3 grid max-h-52 grid-cols-3 gap-2 overflow-y-auto p-0.5"
            >
              {assets.map((asset) => {
                const selected =
                  board.cover?.kind === "asset" &&
                  board.cover.assetId === asset.id;
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      aria-label={`Use ${asset.originalName ?? "board image"} as cover`}
                      aria-pressed={selected}
                      disabled={saving}
                      onClick={() => void chooseCover(asset.id)}
                      className="aspect-square w-full overflow-hidden rounded-radius-md bg-light-surface-tint ring-1 ring-border-subtle outline-none hover:ring-sky-blue-accent/45 focus-visible:outline-2 focus-visible:outline-sky-blue-accent aria-pressed:ring-2 aria-pressed:ring-sky-blue-accent disabled:opacity-45"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin API media */}
                      <img
                        src={asset.src}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            disabled={!board.cover || saving}
            onClick={() => void chooseCover(null)}
            className="mt-3 min-h-9 w-full rounded-radius-md px-2 text-sm font-medium text-muted-gray ring-1 ring-border-subtle outline-none hover:bg-light-surface-tint hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent disabled:opacity-45"
          >
            Clear cover
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import {
  ArrowDownTrayIcon,
  DocumentIcon,
  PhotoIcon,
} from "@heroicons/react/16/solid";
import { useState } from "react";
import type { Editor, TLShapeId } from "tldraw";

import { FabricDialog } from "@/components/fabric-whiteboard/fabric-dialog";

type ExportFormat = "png" | "svg";

function safeFileName(title: string, format: ExportFormat): string {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "fabric-board";
  return `${stem}.${format}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportShapeIds(editor: Editor): TLShapeId[] {
  const selected = editor.getSelectedShapeIds();
  return selected.length > 0
    ? selected
    : [...editor.getCurrentPageShapeIds()];
}

export function FabricExportDialog({
  editor,
  boardTitle,
  open,
  onClose,
}: {
  editor: Editor | null;
  boardTitle: string;
  open: boolean;
  onClose: () => void;
}) {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportBoard(format: ExportFormat) {
    if (!editor) return;
    const shapeIds = exportShapeIds(editor);
    if (shapeIds.length === 0) {
      setError("This board has no objects to export. Add an object and try again.");
      return;
    }

    setExporting(format);
    setError(null);
    try {
      if (format === "png") {
        const result = await editor.toImage(shapeIds, {
          format: "png",
          background: true,
          padding: 32,
          pixelRatio: 2,
        });
        downloadBlob(result.blob, safeFileName(boardTitle, "png"));
      } else {
        const result = await editor.getSvgString(shapeIds, {
          background: true,
          padding: 32,
        });
        if (!result) throw new Error("The SVG renderer returned no image.");
        downloadBlob(
          new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }),
          safeFileName(boardTitle, "svg"),
        );
      }
      onClose();
    } catch {
      setError("Fabric could not export this board. Check embedded images and try again.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <FabricDialog
      open={open}
      title="Export Board"
      description="Exports the current selection, or the full page when nothing is selected."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p className="rounded-radius-md bg-(--danger-soft) p-3 text-base text-(--danger) sm:text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="flex min-h-28 flex-col items-start justify-between gap-4 rounded-radius-lg p-4 text-left outline-none ring-1 ring-near-black-primary-text/10 hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent disabled:opacity-45"
            disabled={!editor || exporting !== null}
            onClick={() => void exportBoard("png")}
          >
            <PhotoIcon className="size-4 shrink-0 fill-sky-blue-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">PNG Image</p>
              <p className="text-base text-muted-gray sm:text-sm">High-resolution image for documents and presentations.</p>
            </div>
          </button>
          <button
            type="button"
            className="flex min-h-28 flex-col items-start justify-between gap-4 rounded-radius-lg p-4 text-left outline-none ring-1 ring-near-black-primary-text/10 hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent disabled:opacity-45"
            disabled={!editor || exporting !== null}
            onClick={() => void exportBoard("svg")}
          >
            <DocumentIcon className="size-4 shrink-0 fill-sky-blue-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">SVG Vector</p>
              <p className="text-base text-muted-gray sm:text-sm">Scalable artwork for design tools and the web.</p>
            </div>
          </button>
        </div>
        {exporting ? (
          <p className="flex items-center gap-2 text-base text-muted-gray sm:text-sm" role="status">
            <ArrowDownTrayIcon className="size-4 h-lh shrink-0 fill-current" aria-hidden="true" />
            Exporting {exporting.toUpperCase()}…
          </p>
        ) : null}
      </div>
    </FabricDialog>
  );
}

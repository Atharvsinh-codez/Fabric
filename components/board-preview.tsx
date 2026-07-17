"use client";

import { useState } from "react";

import type { BoardSummary } from "@/lib/boards/client";

function boardThumbnailSource(board: BoardSummary): string {
  const version = `${board.documentGenerationId}.${board.revision}`;
  return `/api/boards/${encodeURIComponent(board.id)}/thumbnail?v=${encodeURIComponent(version)}`;
}

export function BoardPreview({ board }: { board: BoardSummary }) {
  const source = boardThumbnailSource(board);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === source;

  return (
    <div
      className="relative aspect-[16/10] overflow-hidden rounded-t-radius-xl bg-[#fbfdff] [background-image:linear-gradient(rgb(97_116_137/8%)_1px,transparent_1px),linear-gradient(90deg,rgb(97_116_137/8%)_1px,transparent_1px)] [background-size:24px_24px]"
      aria-hidden="true"
    >
      {!failed ? (
        // The browser must send the member's same-origin cookie directly; the
        // public Next image optimizer must never proxy this private response.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.012]"
          onError={() => setFailedSource(source)}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-near-black-primary-text/4" />
    </div>
  );
}

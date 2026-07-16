"use client";

import { XMarkIcon } from "@heroicons/react/16/solid";
import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { IconButton } from "@/components/ui";

export function FabricDialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const closeFromBackdrop = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.currentTarget === event.target) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}
      className="m-auto w-[min(calc(100%_-_2rem),32rem)] max-h-[min(42rem,calc(100dvh_-_2rem))] overflow-hidden rounded-radius-2xl bg-surface-white p-0 text-near-black-primary-text floating-shadow backdrop:bg-near-black-primary-text/25"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={closeFromBackdrop}
    >
      <section className="flex max-h-[min(42rem,calc(100dvh_-_2rem))] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-near-black-primary-text/8 px-5 py-4">
          <div className="min-w-0">
            <h2
              id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}
              className="text-balance text-lg font-medium tracking-tight"
            >
              {title}
            </h2>
            {description ? (
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label={`Close ${title}`} onClick={onClose}>
            <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
          </IconButton>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">{children}</div>
      </section>
    </dialog>
  );
}

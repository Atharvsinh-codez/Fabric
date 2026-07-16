"use client";

import {
  ArrowRightIcon,
  ArrowsRightLeftIcon,
  LightBulbIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
} from "@heroicons/react/16/solid";
import {
  useCallback,
  useState,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SVGProps,
} from "react";
import type { Editor } from "tldraw";

import { FabricDialog } from "@/components/fabric-whiteboard/fabric-dialog";
import { Button, cx } from "@/components/ui";
import {
  FABRIC_TEMPLATES,
  insertFabricTemplate,
  type FabricTemplateId,
  type FabricTemplateInsertionResult,
} from "@/lib/boards/tldraw-templates";

type TemplateIcon = ForwardRefExoticComponent<
  Omit<SVGProps<SVGSVGElement>, "ref"> & RefAttributes<SVGSVGElement>
>;

const templateIcons: Record<FabricTemplateId, TemplateIcon> = {
  brainstorm: LightBulbIcon,
  "customer-journey": ArrowsRightLeftIcon,
  kanban: ViewColumnsIcon,
  swot: Squares2X2Icon,
};

export type FabricTemplateLibraryDialogProps = Readonly<{
  editor: Editor | null;
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
  onInserted?: (
    result: Extract<FabricTemplateInsertionResult, { ok: true }>,
  ) => void;
}>;

function BrainstormPreview() {
  return (
    <div className="relative size-full" aria-hidden="true">
      <div className="absolute top-[47%] left-[46%] h-px w-8 -translate-x-full -rotate-25 bg-sky-blue-accent/40" />
      <div className="absolute top-[47%] right-[46%] h-px w-8 translate-x-full rotate-25 bg-sky-blue-accent/40" />
      <div className="absolute bottom-[42%] left-[46%] h-px w-8 -translate-x-full rotate-25 bg-sky-blue-accent/40" />
      <div className="absolute right-[46%] bottom-[42%] h-px w-8 translate-x-full -rotate-25 bg-sky-blue-accent/40" />
      <div className="absolute top-2.5 left-3 size-8 rounded-radius-sm bg-white ring-1 ring-sky-blue-accent/20" />
      <div className="absolute top-2.5 right-3 size-8 rounded-radius-sm bg-white ring-1 ring-amber-500/20" />
      <div className="absolute bottom-2.5 left-3 size-8 rounded-radius-sm bg-white ring-1 ring-emerald-500/20" />
      <div className="absolute right-3 bottom-2.5 size-8 rounded-radius-sm bg-white ring-1 ring-violet-500/20" />
      <div className="absolute top-1/2 left-1/2 h-7 w-12 -translate-1/2 rounded-radius-pill bg-sky-blue-accent" />
    </div>
  );
}

function CustomerJourneyPreview() {
  return (
    <div className="grid size-full grid-cols-[1fr_5fr] gap-1 p-2" aria-hidden="true">
      <div className="grid grid-rows-[1fr_3fr_3fr_3fr] gap-1">
        <div />
        <div className="rounded-[2px] bg-near-black-primary-text/8" />
        <div className="rounded-[2px] bg-near-black-primary-text/8" />
        <div className="rounded-[2px] bg-near-black-primary-text/8" />
      </div>
      <div className="grid grid-cols-5 grid-rows-[1fr_3fr_3fr_3fr] gap-1">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={`journey-heading-${index}`} className="rounded-[2px] bg-sky-blue-accent" />
        ))}
        {Array.from({ length: 15 }, (_, index) => (
          <div
            key={`journey-cell-${index}`}
            className={cx(
              "rounded-[2px] bg-white ring-1 ring-near-black-primary-text/8",
              index >= 10 && "bg-sky-blue-accent/8",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanPreview() {
  return (
    <div className="grid size-full grid-cols-4 gap-1.5 p-2" aria-hidden="true">
      {[3, 2, 2, 2].map((taskCount, columnIndex) => (
        <div
          key={`kanban-column-${columnIndex}`}
          className="flex min-w-0 flex-col gap-1 rounded-[3px] bg-near-black-primary-text/4 p-1"
        >
          <div
            className={cx(
              "h-2.5 shrink-0 rounded-[2px]",
              columnIndex === 1 ? "bg-sky-blue-accent" : "bg-near-black-primary-text/16",
            )}
          />
          {Array.from({ length: taskCount }, (_, taskIndex) => (
            <div
              key={`kanban-task-${columnIndex}-${taskIndex}`}
              className="h-3.5 shrink-0 rounded-[2px] bg-white ring-1 ring-near-black-primary-text/8"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SwotPreview() {
  return (
    <div className="grid size-full grid-cols-2 gap-1.5 p-2" aria-hidden="true">
      <div className="rounded-radius-sm bg-emerald-50 ring-1 ring-emerald-500/20" />
      <div className="rounded-radius-sm bg-rose-50 ring-1 ring-rose-500/20" />
      <div className="rounded-radius-sm bg-sky-50 ring-1 ring-sky-blue-accent/20" />
      <div className="rounded-radius-sm bg-amber-50 ring-1 ring-amber-500/20" />
    </div>
  );
}

function TemplatePreview({ templateId }: { templateId: FabricTemplateId }) {
  return (
    <div className="h-24 overflow-hidden rounded-radius-sm bg-light-surface-tint ring-1 ring-near-black-primary-text/5">
      {templateId === "brainstorm" ? <BrainstormPreview /> : null}
      {templateId === "customer-journey" ? <CustomerJourneyPreview /> : null}
      {templateId === "kanban" ? <KanbanPreview /> : null}
      {templateId === "swot" ? <SwotPreview /> : null}
    </div>
  );
}

export function FabricTemplateLibraryDialog({
  editor,
  open,
  canEdit,
  onClose,
  onInserted,
}: FabricTemplateLibraryDialogProps) {
  const [announcement, setAnnouncement] = useState("");

  const insertTemplate = useCallback(
    (templateId: FabricTemplateId) => {
      const result = insertFabricTemplate(canEdit ? editor : null, templateId);
      if (!result.ok) {
        setAnnouncement(
          result.reason === "readonly"
            ? "This board is view-only. Ask an owner for edit access to add a template"
            : "The whiteboard is still loading. Try adding the template again",
        );
        return;
      }

      setAnnouncement(`${result.template.name} added to the board`);
      onInserted?.(result);
      onClose();
    },
    [canEdit, editor, onClose, onInserted],
  );

  const availabilityMessage = !canEdit
    ? "This board is view-only. Ask an owner for edit access to add a template."
    : !editor
      ? "The whiteboard is loading. Templates will be available in a moment."
      : "Every template uses editable native shapes and lands in your current view.";

  return (
    <>
      <FabricDialog
        open={open}
        title="Template Library"
        description="Start with a useful structure, then make every shape your own."
        onClose={onClose}
      >
        <div className="flex flex-col gap-4">
          <p className="rounded-radius-lg bg-light-surface-tint px-3 py-2 text-pretty text-base text-muted-gray sm:text-sm">
            {availabilityMessage}
          </p>
          <div className="@container">
            <div className="grid grid-cols-1 gap-3 @min-[27rem]:grid-cols-2">
              {FABRIC_TEMPLATES.map((template) => {
                const Icon = templateIcons[template.id];
                const descriptionId = `fabric-template-${template.id}-description`;
                const disabled = !canEdit || !editor;

                return (
                  <article
                    key={template.id}
                    className="flex min-w-0 flex-col gap-3 rounded-radius-xl bg-surface-white p-3 ring-1 ring-near-black-primary-text/8"
                  >
                    <TemplatePreview templateId={template.id} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex min-w-0 items-start gap-2">
                        <Icon
                          className="size-4 h-lh shrink-0 fill-sky-blue-accent"
                          aria-hidden="true"
                        />
                        <h3 className="min-w-0 text-balance text-base font-medium">
                          {template.name}
                        </h3>
                      </div>
                      <p
                        id={descriptionId}
                        className="text-pretty text-base text-muted-gray sm:text-sm"
                      >
                        {template.description}
                      </p>
                    </div>
                    <Button
                      className="group self-start"
                      disabled={disabled}
                      aria-describedby={descriptionId}
                      onClick={() => insertTemplate(template.id)}
                      leading={
                        <ArrowRightIcon
                          className="size-4 shrink-0 fill-current transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none"
                          aria-hidden="true"
                        />
                      }
                    >
                      Insert Template
                    </Button>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </FabricDialog>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}

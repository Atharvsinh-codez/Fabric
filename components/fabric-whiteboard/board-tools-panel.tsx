"use client";

import {
  AcademicCapIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  BeakerIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ClockIcon,
  LanguageIcon,
  LightBulbIcon,
  PauseIcon,
  PlayIcon,
  QueueListIcon,
  RectangleStackIcon,
  ScaleIcon,
  Squares2X2Icon,
  TableCellsIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type SVGProps,
} from "react";
import type { Editor } from "tldraw";

import { FabricBoardNavigationPanel } from "@/components/fabric-whiteboard/board-navigation-panel";
import { FabricStemToolkitPanel } from "@/components/fabric-whiteboard/stem-toolkit-panel";
import { Button, IconButton, cx } from "@/components/ui";
import {
  EDUCATION_TEMPLATES,
  insertEducationTemplate,
  type EducationTemplateId,
} from "@/lib/boards/tldraw-education-templates";
import {
  STUDY_KITS,
  insertStudyKit,
  type StudyKitId,
} from "@/lib/boards/tldraw-study-tools";
import {
  FABRIC_TEMPLATES,
  insertFabricTemplate,
  type FabricTemplateId,
} from "@/lib/boards/tldraw-templates";

type BoardToolsTab = "study" | "stem" | "navigate" | "focus" | "templates";
type TemplateGroup = "education" | "planning";
type ToolIcon = ComponentType<SVGProps<SVGSVGElement>>;

const tabs: readonly Readonly<{ id: BoardToolsTab; label: string }>[] = [
  { id: "study", label: "Study" },
  { id: "stem", label: "STEM" },
  { id: "navigate", label: "Navigate" },
  { id: "focus", label: "Focus" },
  { id: "templates", label: "Templates" },
];

const studyKitIcons: Record<StudyKitId, ToolIcon> = {
  "cornell-notes": BookOpenIcon,
  "concept-map": LightBulbIcon,
  "study-planner": QueueListIcon,
  "recall-cards": AcademicCapIcon,
};

const templateIcons: Record<FabricTemplateId, ToolIcon> = {
  brainstorm: LightBulbIcon,
  "customer-journey": ArrowsRightLeftIcon,
  kanban: ViewColumnsIcon,
  swot: Squares2X2Icon,
};

const educationTemplateIcons: Record<EducationTemplateId, ToolIcon> = {
  "lesson-plan": AcademicCapIcon,
  "kwl-chart": TableCellsIcon,
  "vocabulary-map": LanguageIcon,
  "lab-report": BeakerIcon,
  "revision-timetable": CalendarDaysIcon,
  "comparison-diagram": ScaleIcon,
};

const focusPresets = [15, 25, 50] as const;

function insertionFailureMessage(
  reason: "capacity" | "editor-unavailable" | "invalid-calculation" | "readonly",
): string {
  if (reason === "readonly") {
    return "This board is view-only. Ask an owner for edit access before adding board tools.";
  }
  if (reason === "capacity") {
    return "The board could not fit those shapes. Remove unused content and try again.";
  }
  if (reason === "invalid-calculation") {
    return "The calculation changed before it was added. Check it and try again.";
  }
  return "The whiteboard is still loading. Try adding the board tool again.";
}

function formatFocusTime(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function ToolListItem({
  icon: Icon,
  title,
  description,
  actionLabel,
  disabled,
  onInsert,
}: {
  icon: ToolIcon;
  title: string;
  description: string;
  actionLabel: string;
  disabled: boolean;
  onInsert: () => void;
}) {
  return (
    <li className="flex min-w-0 items-start gap-3 border-t border-near-black-primary-text/8 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <Icon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="font-medium">{title}</h3>
        <p className="text-pretty text-base text-muted-gray sm:text-sm">{description}</p>
      </div>
      <Button className="self-start" disabled={disabled} onClick={onInsert}>
        {actionLabel}
        <span
          className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
          aria-hidden="true"
        />
      </Button>
    </li>
  );
}

export function FabricBoardToolsPanel({
  editor,
  boardId,
  open,
  canEdit,
  onOpen,
  onClose,
}: {
  editor: Editor | null;
  boardId: string;
  open: boolean;
  canEdit: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<BoardToolsTab>("study");
  const [templateGroup, setTemplateGroup] = useState<TemplateGroup>("education");
  const [announcement, setAnnouncement] = useState("");
  const [selectedMinutes, setSelectedMinutes] = useState<number>(25);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const deadlineRef = useRef<number | null>(null);
  const timerActive = timerRunning || remainingSeconds !== selectedMinutes * 60;
  const timerProgress = selectedMinutes > 0
    ? Math.min(100, Math.max(0, 100 - (remainingSeconds / (selectedMinutes * 60)) * 100))
    : 0;

  const updateRemainingFromDeadline = useCallback(() => {
    if (deadlineRef.current === null) return;
    const next = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1_000));
    setRemainingSeconds(next);
    if (next === 0) {
      deadlineRef.current = null;
      setTimerRunning(false);
      setAnnouncement("Focus session complete. Take a short break before the next round.");
    }
  }, []);

  useEffect(() => {
    if (!timerRunning) return;
    updateRemainingFromDeadline();
    const interval = window.setInterval(updateRemainingFromDeadline, 250);
    return () => window.clearInterval(interval);
  }, [timerRunning, updateRemainingFromDeadline]);

  useEffect(() => {
    if (canEdit) return;
    deadlineRef.current = null;
    const timeout = window.setTimeout(() => setTimerRunning(false), 0);
    return () => window.clearTimeout(timeout);
  }, [canEdit]);

  const selectTimerPreset = (minutes: number) => {
    deadlineRef.current = null;
    setTimerRunning(false);
    setSelectedMinutes(minutes);
    setRemainingSeconds(minutes * 60);
    setAnnouncement(`${minutes}-minute personal focus timer ready.`);
  };

  const startTimer = () => {
    const nextSeconds = remainingSeconds > 0 ? remainingSeconds : selectedMinutes * 60;
    setRemainingSeconds(nextSeconds);
    deadlineRef.current = Date.now() + nextSeconds * 1_000;
    setTimerRunning(true);
    setAnnouncement("Personal focus timer started.");
  };

  const pauseTimer = () => {
    updateRemainingFromDeadline();
    deadlineRef.current = null;
    setTimerRunning(false);
    setAnnouncement("Personal focus timer paused.");
  };

  const resetTimer = () => {
    deadlineRef.current = null;
    setTimerRunning(false);
    setRemainingSeconds(selectedMinutes * 60);
    setAnnouncement("Personal focus timer reset.");
  };

  const addTimerMinutes = (minutes: number) => {
    const addedSeconds = minutes * 60;
    if (timerRunning && deadlineRef.current !== null) {
      deadlineRef.current += addedSeconds * 1_000;
      updateRemainingFromDeadline();
    } else {
      setRemainingSeconds((current) => current + addedSeconds);
    }
    setAnnouncement(`${minutes} ${minutes === 1 ? "minute" : "minutes"} added to the timer.`);
  };

  const addStudyKit = (id: StudyKitId) => {
    const result = insertStudyKit(canEdit ? editor : null, id);
    if (!result.ok) {
      setAnnouncement(insertionFailureMessage(result.reason));
      return;
    }
    setAnnouncement(`${result.name} added to the board.`);
  };

  const addTemplate = (id: FabricTemplateId) => {
    const result = insertFabricTemplate(canEdit ? editor : null, id);
    if (!result.ok) {
      setAnnouncement(insertionFailureMessage(result.reason));
      return;
    }
    setAnnouncement(`${result.template.name} added to the board.`);
  };

  const addEducationTemplate = (id: EducationTemplateId) => {
    const result = insertEducationTemplate(canEdit ? editor : null, id);
    if (!result.ok) {
      setAnnouncement(insertionFailureMessage(result.reason));
      return;
    }
    setAnnouncement(`${result.template.name} added to the board.`);
  };

  if (!canEdit) return null;

  if (!open) {
    if (!timerActive) {
      return (
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      );
    }
    return (
      <>
        <aside
          className="pointer-events-auto absolute right-3 bottom-20 z-900 flex items-center gap-1 rounded-radius-lg bg-surface-white p-1 floating-shadow ring-1 ring-near-black-primary-text/5 drawer-enter"
          aria-label="Personal Focus Timer"
        >
          <button
            type="button"
            className="relative flex h-9 items-center gap-2 rounded-radius-md py-2 pr-3 pl-2 text-base font-medium outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:text-sm"
            onClick={onOpen}
          >
            <ClockIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
            <span>My Focus</span>
            <span className="tabular-nums text-sky-blue-accent">{formatFocusTime(remainingSeconds)}</span>
            <span
              className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
              aria-hidden="true"
            />
          </button>
          <IconButton
            label={timerRunning ? "Pause Focus Timer" : "Resume Focus Timer"}
            tooltipSide="top"
            onClick={timerRunning ? pauseTimer : startTimer}
          >
            {timerRunning ? (
              <PauseIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
            ) : (
              <PlayIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
            )}
          </IconButton>
        </aside>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </>
    );
  }

  return (
    <>
      <aside
        id="fabric-board-tools-panel"
        aria-label="Board Tools"
        className="absolute inset-x-2 bottom-2 z-1000 flex max-h-[calc(100dvh_-_5rem)] flex-col overflow-hidden rounded-radius-xl bg-surface-white floating-shadow ring-1 ring-near-black-primary-text/5 drawer-enter sm:inset-x-auto sm:top-16 sm:right-3 sm:bottom-3 sm:w-[23rem]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-near-black-primary-text/8 px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <AcademicCapIcon
              className="size-4 h-lh shrink-0 fill-sky-blue-accent"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h2 className="font-medium">Board Tools</h2>
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                Study, solve, and move around your board.
              </p>
            </div>
          </div>
          <IconButton
            label="Close Board Tools"
            tooltipAlign="end"
            onClick={onClose}
          >
            <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
          </IconButton>
        </header>

        <div
          className="grid shrink-0 grid-cols-[repeat(5,minmax(4.25rem,1fr))] gap-1 overflow-x-auto border-b border-near-black-primary-text/8 p-2"
          role="tablist"
          aria-label="Board Tool Categories"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`fabric-board-tools-${item.id}-tab`}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`fabric-board-tools-${item.id}-panel`}
              className={cx(
                "relative h-10 min-w-0 rounded-radius-md px-1 text-[0.8125rem] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8 sm:text-sm",
                tab === item.id
                  ? "bg-light-surface-tint text-near-black-primary-text"
                  : "text-muted-gray hover:bg-light-surface-tint hover:text-near-black-primary-text",
              )}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              <span
                className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "study" ? (
            <section
              id="fabric-board-tools-study-panel"
              role="tabpanel"
              aria-labelledby="fabric-board-tools-study-tab"
              className="flex flex-col gap-4"
            >
              <div className="flex items-start gap-2.5 rounded-radius-lg bg-light-surface-tint p-3">
                <BookOpenIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
                <p className="text-pretty text-base text-muted-gray sm:text-sm">
                  Every layout is made from editable native shapes and joins the same undo and multiplayer history as the rest of your board.
                </p>
              </div>
              <ul role="list">
                {STUDY_KITS.map((kit) => (
                  <ToolListItem
                    key={kit.id}
                    icon={studyKitIcons[kit.id]}
                    title={kit.name}
                    description={kit.description}
                    actionLabel="Add Layout"
                    disabled={!editor}
                    onInsert={() => addStudyKit(kit.id)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {tab === "stem" ? (
            <section
              id="fabric-board-tools-stem-panel"
              role="tabpanel"
              aria-labelledby="fabric-board-tools-stem-tab"
            >
              <FabricStemToolkitPanel
                editor={editor}
                onAnnouncement={setAnnouncement}
              />
            </section>
          ) : null}

          {tab === "focus" ? (
            <section
              id="fabric-board-tools-focus-panel"
              role="tabpanel"
              aria-labelledby="fabric-board-tools-focus-tab"
              className="flex flex-col gap-5"
            >
              <div className="flex flex-col items-center gap-3 rounded-radius-xl bg-light-surface-tint p-5 ring-1 ring-near-black-primary-text/5">
                <ClockIcon className="size-4 shrink-0 fill-sky-blue-accent" aria-hidden="true" />
                <p className="text-5xl font-medium tracking-tight tabular-nums">
                  {formatFocusTime(remainingSeconds)}
                </p>
                <p className="text-pretty text-center text-base text-muted-gray sm:text-sm">
                  Personal timer. It stays on this device and minimizes over your board.
                </p>
                <div className="h-1.5 w-full overflow-hidden rounded-radius-pill bg-near-black-primary-text/8">
                  <div
                    className="h-full w-(--focus-progress) rounded-radius-pill bg-sky-blue-accent transition-[width] duration-200 ease-out motion-reduce:transition-none"
                    style={{ "--focus-progress": `${timerProgress}%` } as CSSProperties}
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="font-medium">Session Length</p>
                <div className="flex flex-wrap gap-2">
                  {focusPresets.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={selectedMinutes === minutes}
                      className={cx(
                        "relative h-9 rounded-radius-md px-3 text-base font-medium tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8 sm:text-sm",
                        selectedMinutes === minutes
                          ? "bg-(--accent-soft) text-sky-blue-accent ring-1 ring-sky-blue-accent/20"
                          : "bg-surface-white text-muted-gray ring-1 ring-border-subtle hover:bg-light-surface-tint hover:text-near-black-primary-text",
                      )}
                      onClick={() => selectTimerPreset(minutes)}
                    >
                      {minutes} Min
                      <span
                        className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  tone="primary"
                  leading={timerRunning
                    ? <PauseIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
                    : <PlayIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
                  onClick={timerRunning ? pauseTimer : startTimer}
                >
                  {timerRunning ? "Pause Timer" : remainingSeconds === 0 ? "Restart Timer" : "Start Timer"}
                </Button>
                <Button
                  leading={<ArrowPathIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
                  onClick={resetTimer}
                >
                  Reset Timer
                </Button>
                <Button tone="ghost" onClick={() => addTimerMinutes(1)}>
                  Add 1 Minute
                </Button>
                <Button tone="ghost" onClick={() => addTimerMinutes(5)}>
                  Add 5 Minutes
                </Button>
              </div>
            </section>
          ) : null}

          {tab === "navigate" ? (
            <section
              id="fabric-board-tools-navigate-panel"
              role="tabpanel"
              aria-labelledby="fabric-board-tools-navigate-tab"
            >
              <FabricBoardNavigationPanel
                editor={editor}
                boardId={boardId}
                onAnnouncement={setAnnouncement}
              />
            </section>
          ) : null}

          {tab === "templates" ? (
            <section
              id="fabric-board-tools-templates-panel"
              role="tabpanel"
              aria-labelledby="fabric-board-tools-templates-tab"
              className="flex flex-col gap-4"
            >
              <div className="flex items-start gap-2.5 rounded-radius-lg bg-light-surface-tint p-3">
                <RectangleStackIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
                <p className="text-pretty text-base text-muted-gray sm:text-sm">
                  Add a complete, editable learning or planning layout without leaving the board.
                </p>
              </div>
              <div
                className="grid grid-cols-2 gap-1 rounded-radius-lg bg-light-surface-tint p-1"
                aria-label="Template Collections"
              >
                {([
                  { id: "education", label: "Education" },
                  { id: "planning", label: "Planning" },
                ] as const).map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={templateGroup === group.id}
                    className={cx(
                      "relative h-10 rounded-radius-md px-3 text-base font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8 sm:text-sm",
                      templateGroup === group.id
                        ? "bg-surface-white text-near-black-primary-text ring-1 ring-near-black-primary-text/8"
                        : "text-muted-gray hover:text-near-black-primary-text",
                    )}
                    onClick={() => setTemplateGroup(group.id)}
                  >
                    {group.label}
                    <span
                      className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
              <ul role="list">
                {templateGroup === "education"
                  ? EDUCATION_TEMPLATES.map((template) => (
                      <ToolListItem
                        key={template.id}
                        icon={educationTemplateIcons[template.id]}
                        title={template.name}
                        description={template.description}
                        actionLabel="Add Template"
                        disabled={!editor}
                        onInsert={() => addEducationTemplate(template.id)}
                      />
                    ))
                  : FABRIC_TEMPLATES.map((template) => (
                      <ToolListItem
                        key={template.id}
                        icon={templateIcons[template.id]}
                        title={template.name}
                        description={template.description}
                        actionLabel="Add Template"
                        disabled={!editor}
                        onInsert={() => addTemplate(template.id)}
                      />
                    ))}
              </ul>
            </section>
          ) : null}
        </div>
      </aside>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}

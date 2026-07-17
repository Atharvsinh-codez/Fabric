"use client";

import {
  AcademicCapIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  BackspaceIcon,
  BookOpenIcon,
  CalculatorIcon,
  ClockIcon,
  LightBulbIcon,
  PauseIcon,
  PlayIcon,
  QueueListIcon,
  RectangleStackIcon,
  Squares2X2Icon,
  ViewColumnsIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type SVGProps,
} from "react";
import type { Editor } from "tldraw";

import { Button, IconButton, cx } from "@/components/ui";
import { calculateStudyExpression } from "@/lib/boards/study-calculator";
import {
  STUDY_KITS,
  insertCalculationCard,
  insertStudyKit,
  type StudyKitId,
} from "@/lib/boards/tldraw-study-tools";
import {
  FABRIC_TEMPLATES,
  insertFabricTemplate,
  type FabricTemplateId,
} from "@/lib/boards/tldraw-templates";

type BoardToolsTab = "study" | "calculator" | "focus" | "templates";
type ToolIcon = ComponentType<SVGProps<SVGSVGElement>>;

const tabs: readonly Readonly<{ id: BoardToolsTab; label: string }>[] = [
  { id: "study", label: "Study" },
  { id: "calculator", label: "Calculator" },
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

const calculatorKeys = [
  { label: "7", value: "7", name: "Seven" },
  { label: "8", value: "8", name: "Eight" },
  { label: "9", value: "9", name: "Nine" },
  { label: "÷", value: "÷", name: "Divide" },
  { label: "√", value: "sqrt(", name: "Square Root" },
  { label: "4", value: "4", name: "Four" },
  { label: "5", value: "5", name: "Five" },
  { label: "6", value: "6", name: "Six" },
  { label: "×", value: "×", name: "Multiply" },
  { label: "^", value: "^", name: "Power" },
  { label: "1", value: "1", name: "One" },
  { label: "2", value: "2", name: "Two" },
  { label: "3", value: "3", name: "Three" },
  { label: "−", value: "−", name: "Subtract" },
  { label: "(", value: "(", name: "Open Parenthesis" },
  { label: "0", value: "0", name: "Zero" },
  { label: ".", value: ".", name: "Decimal Point" },
  { label: "π", value: "π", name: "Pi" },
  { label: "+", value: "+", name: "Add" },
  { label: ")", value: ")", name: "Close Parenthesis" },
] as const;

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
  open,
  canEdit,
  onOpen,
  onClose,
}: {
  editor: Editor | null;
  open: boolean;
  canEdit: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<BoardToolsTab>("study");
  const [expression, setExpression] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [selectedMinutes, setSelectedMinutes] = useState<number>(25);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const deadlineRef = useRef<number | null>(null);
  const calculation = useMemo(
    () => calculateStudyExpression(expression),
    [expression],
  );
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

  const addCalculation = () => {
    if (!calculation.ok) {
      setAnnouncement(calculation.message);
      return;
    }
    const result = insertCalculationCard(canEdit ? editor : null, calculation);
    if (!result.ok) {
      setAnnouncement(insertionFailureMessage(result.reason));
      return;
    }
    setAnnouncement("Calculation added to the board.");
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
                Build study spaces, calculate, and stay focused.
              </p>
            </div>
          </div>
          <IconButton label="Close Board Tools" onClick={onClose}>
            <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
          </IconButton>
        </header>

        <div
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-near-black-primary-text/8 p-2"
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
                "relative h-8 shrink-0 rounded-radius-md px-2.5 text-base font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:text-sm",
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

          {tab === "calculator" ? (
            <section
              id="fabric-board-tools-calculator-panel"
              role="tabpanel"
              aria-labelledby="fabric-board-tools-calculator-tab"
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <label htmlFor="fabric-study-expression" className="font-medium">
                  Expression
                </label>
                <div className="flex items-center gap-1 rounded-radius-lg bg-surface-white p-1 ring-1 ring-near-black-primary-text/10 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-sky-blue-accent">
                  <CalculatorIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
                  <input
                    id="fabric-study-expression"
                    name="study-expression"
                    value={expression}
                    maxLength={160}
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Try (12.5 × 4) + sqrt(81)"
                    className="h-10 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-gray sm:h-8 sm:text-sm"
                    onChange={(event) => setExpression(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && calculation.ok) {
                        event.preventDefault();
                        addCalculation();
                      }
                    }}
                  />
                  <IconButton
                    label="Delete Last Calculator Character"
                    tooltipSide="top"
                    disabled={!expression}
                    onClick={() => setExpression((current) => current.slice(0, -1))}
                  >
                    <BackspaceIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
                  </IconButton>
                </div>
              </div>

              <div
                key={calculation.ok ? calculation.display : calculation.message}
                className={cx(
                  "min-h-20 rounded-radius-lg p-3 ring-1 review-panel-enter",
                  calculation.ok
                    ? "bg-(--accent-soft) ring-sky-blue-accent/20"
                    : expression
                      ? "bg-(--danger-soft) ring-(--danger-border)"
                      : "bg-light-surface-tint ring-near-black-primary-text/5",
                )}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {calculation.ok ? (
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate text-base text-muted-gray sm:text-sm">{calculation.expression}</p>
                    <p className="break-all text-2xl font-medium tracking-tight tabular-nums text-sky-blue-accent">
                      = {calculation.display}
                    </p>
                  </div>
                ) : (
                  <p className="text-pretty text-base text-muted-gray sm:text-sm">
                    {expression
                      ? calculation.message
                      : "Enter an expression or use the keypad. Percent divides the value before it by 100."}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-5 gap-1.5" aria-label="Calculator Keypad">
                {calculatorKeys.map((key) => (
                  <button
                    key={key.name}
                    type="button"
                    aria-label={key.name}
                    className="relative h-12 rounded-radius-md bg-light-surface-tint text-base font-medium outline-none hover:bg-(--accent-soft) active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent motion-reduce:transform-none sm:h-9 sm:text-sm"
                    onClick={() => setExpression((current) => `${current}${key.value}`.slice(0, 160))}
                  >
                    {key.label}
                    <span
                      className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button tone="ghost" disabled={!expression} onClick={() => setExpression("")}>
                  Clear Expression
                </Button>
                <Button
                  tone="primary"
                  disabled={!editor || !calculation.ok}
                  leading={<CalculatorIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
                  onClick={addCalculation}
                >
                  Add to Board
                </Button>
              </div>
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
                  Start a workshop or planning flow without leaving the current board.
                </p>
              </div>
              <ul role="list">
                {FABRIC_TEMPLATES.map((template) => (
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

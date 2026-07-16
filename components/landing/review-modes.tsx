"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  LightBulbIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

const reviewModes = [
  {
    id: "feedback",
    label: "Feedback",
    shortDescription: "Interrogate the evidence",
    title: "See what the board is trying to tell you.",
    description:
      "Fabric reviews the selection, surfaces tensions, and keeps every observation traceable to its source.",
    results: ["Unsupported claims", "Conflicting evidence", "Questions worth answering"],
    guardrail: "Nothing changes until you review and apply the proposal.",
    icon: ChatBubbleLeftRightIcon,
  },
  {
    id: "suggest",
    label: "Suggest",
    shortDescription: "Shape the next move",
    title: "Move from raw material to useful options.",
    description:
      "Fabric turns selected notes into clear directions, useful structure, and concrete follow ups for the team.",
    results: ["Clear groupings", "Alternative directions", "Practical next steps"],
    guardrail: "Suggestions arrive as a preview, never as a silent edit.",
    icon: LightBulbIcon,
  },
  {
    id: "solve",
    label: "Solve",
    shortDescription: "Synthesize a decision",
    title: "Turn the evidence into a decision.",
    description:
      "Fabric connects the strongest themes, names the tradeoffs, and proposes a direction the team can inspect.",
    results: ["Shared themes", "Explicit tradeoffs", "Decision rationale"],
    guardrail: "The original board stays intact beside every proposed change.",
    icon: SparklesIcon,
  },
] as const;

export function ReviewModes() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sectionId = useId();
  const activeMode = reviewModes[activeIndex];
  const ActiveIcon = activeMode.icon;

  function selectTab(index: number) {
    setActiveIndex(index);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % reviewModes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + reviewModes.length) % reviewModes.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = reviewModes.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    selectTab(nextIndex);
  }

  return (
    <section id="ai" className="scroll-mt-24 bg-[#f6f9fb] py-20 sm:py-28" aria-labelledby={`${sectionId}-title`}>
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,0.55fr)] lg:gap-16">
          <h2
            id={`${sectionId}-title`}
            className="max-w-[15ch] text-balance font-display text-5xl font-normal leading-[0.98] tracking-[-0.045em] text-near-black-primary-text sm:text-6xl"
          >
            Think with AI, without giving up control.
          </h2>
          <p className="max-w-[46ch] text-pretty text-base leading-7 text-muted-gray sm:text-lg">
            Feedback, Suggest, and Solve help teams understand what is on the board before deciding what belongs next.
          </p>
        </div>

        <div className="mt-11 overflow-hidden rounded-[28px] bg-surface-white shadow-[0_24px_80px_rgb(2_54_84/0.09)] ring-1 ring-near-black-primary-text/8 sm:mt-14">
          <div className="grid lg:grid-cols-[minmax(18rem,0.38fr)_minmax(0,0.62fr)]">
            <div
              role="tablist"
              aria-label="Fabric AI review modes"
              className="grid grid-cols-3 gap-1 bg-[#edf4f8] p-2 sm:gap-2 sm:p-3 lg:grid-cols-1 lg:content-start lg:gap-2 lg:p-4"
            >
              {reviewModes.map((mode, index) => {
                const selected = index === activeIndex;
                const ModeIcon = mode.icon;

                return (
                  <button
                    key={mode.id}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    id={`${sectionId}-tab-${mode.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`${sectionId}-panel-${mode.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveIndex(index)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    className={`group relative min-w-0 rounded-[18px] px-3 py-4 text-left outline-none transition-[background-color,color,box-shadow,transform] duration-200 focus-visible:ring-2 focus-visible:ring-sky-blue-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#edf4f8] sm:px-4 lg:min-h-32 lg:px-5 lg:py-5 ${
                      selected
                        ? "bg-surface-white text-near-black-primary-text shadow-[0_8px_24px_rgb(2_54_84/0.08)]"
                        : "text-muted-gray hover:bg-surface-white/65 hover:text-near-black-primary-text"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <ModeIcon
                        className={`size-4 shrink-0 stroke-[1.7] sm:size-5 ${selected ? "text-sky-blue-accent" : "text-current"}`}
                        aria-hidden="true"
                      />
                      <span className="truncate text-sm font-medium sm:text-base">{mode.label}</span>
                    </span>
                    <span className="mt-3 hidden max-w-[22ch] text-pretty text-sm leading-5 text-muted-gray lg:block">
                      {mode.shortDescription}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`absolute inset-x-4 bottom-0 h-0.5 origin-left rounded-full bg-sky-blue-accent transition-transform duration-300 lg:inset-x-5 ${
                        selected ? "scale-x-100" : "scale-x-0"
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="relative min-h-[31rem] overflow-hidden px-6 py-9 sm:px-10 sm:py-11 lg:px-12 lg:py-12">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-32 -right-28 size-80 rounded-full bg-sky-blue-accent/8 blur-3xl"
              />

                <div
                  key={activeMode.id}
                  id={`${sectionId}-panel-${activeMode.id}`}
                  role="tabpanel"
                  aria-labelledby={`${sectionId}-tab-${activeMode.id}`}
                  className="review-panel-enter relative flex min-h-[25rem] flex-col"
                >
                  <div className="flex items-center gap-3 text-sm font-medium text-sky-blue-accent">
                    <span className="grid size-10 place-items-center rounded-full bg-sky-blue-accent/9 ring-1 ring-sky-blue-accent/12">
                      <ActiveIcon className="size-5 stroke-[1.7]" aria-hidden="true" />
                    </span>
                    {activeMode.label}
                  </div>

                  <h3 className="mt-7 max-w-[18ch] text-balance text-3xl font-medium leading-[1.05] tracking-[-0.035em] text-near-black-primary-text sm:text-4xl">
                    {activeMode.title}
                  </h3>
                  <p className="mt-5 max-w-[54ch] text-pretty text-base leading-7 text-muted-gray sm:text-lg">
                    {activeMode.description}
                  </p>

                  <dl className="mt-10 grid gap-0 border-y border-near-black-primary-text/9 sm:grid-cols-3">
                    {activeMode.results.map((result, index) => (
                      <div
                        key={result}
                        className={`py-5 sm:px-5 ${index === 0 ? "sm:pl-0" : "border-t border-near-black-primary-text/9 sm:border-t-0 sm:border-l"}`}
                      >
                        <dt className="text-xs font-medium text-muted-gray">0{index + 1}</dt>
                        <dd className="mt-2 max-w-[16ch] text-pretty text-sm font-medium leading-5 text-near-black-primary-text sm:text-base">
                          {result}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-auto flex items-start gap-3 pt-8 text-sm leading-6 text-muted-gray">
                    <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-sky-blue-accent" aria-hidden="true" />
                    <p className="max-w-[48ch] text-pretty">{activeMode.guardrail}</p>
                  </div>
                </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

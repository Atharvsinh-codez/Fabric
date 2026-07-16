"use client";

import Image from "next/image";
import { useState } from "react";

const panels = [
  {
    title: "Capture anywhere",
    description:
      "Add notes, images, and rough thinking while the work is happening. Fabric keeps the board useful when the connection drops.",
    image: "/images/fabric-capture-anywhere-v1.webp",
    imageAlt: "A researcher works with a tablet and notebook in a bright lounge overlooking an open landscape.",
    imagePosition: "object-[center_48%]",
  },
  {
    title: "Connect evidence",
    description:
      "Keep sources, comments, and decisions together in one spatial workspace so the context stays visible to everyone.",
    image: "/images/fabric-connect-together-v1.webp",
    imageAlt: "Two collaborators connect photographs and diagrams across a bright shared table.",
    imagePosition: "object-center",
  },
  {
    title: "See the direction",
    description:
      "Step back for the pattern, then follow any decision to the evidence that shaped it without rebuilding the story.",
    image: "/images/fabric-see-direction-v1.webp",
    imageAlt: "A quiet path winds through rolling hills toward a bright horizon.",
    imagePosition: "object-[center_66%]",
  },
] as const;

export function ExploreAccordion() {
  const [activePanel, setActivePanel] = useState(0);

  return (
    <section
      id="collaboration"
      className="scroll-mt-24 bg-surface-white py-20 text-near-black-primary-text sm:py-28"
      aria-labelledby="explore-heading"
    >
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="grid items-end gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:gap-16">
          <h2
            id="explore-heading"
            className="max-w-[15ch] text-balance font-display text-5xl font-normal tracking-[-0.04em] sm:text-6xl"
          >
            From first thought to shared direction.
          </h2>
          <p className="max-w-[42ch] text-pretty text-base leading-7 text-muted-gray sm:text-lg">
            Capture the work as it happens, keep its context attached, and bring the team back to one clear picture.
          </p>
        </div>

        <div
          className="mt-10 flex flex-col gap-2 sm:mt-12 lg:grid lg:h-[34rem] lg:grid-cols-3"
          aria-label="Explore the Fabric workflow"
        >
          {panels.map((panel, index) => {
            const isActive = activePanel === index;
            const titleId = `explore-panel-title-${index}`;
            const contentId = `explore-panel-content-${index}`;

            return (
              <article
                key={panel.title}
                data-active={isActive || undefined}
                className={[
                  "group relative isolate min-w-0 overflow-hidden rounded-radius-2xl bg-slate-button-dark ring-1 transition-[height] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:h-full lg:transition-none",
                  isActive
                    ? "h-[29rem] ring-sky-blue-accent/60"
                    : "h-20 ring-near-black-primary-text/10",
                ].join(" ")}
              >
                <Image
                  src={panel.image}
                  alt={panel.imageAlt}
                  fill
                  sizes="(min-width: 1024px) 34vw, 100vw"
                  className={[
                    "object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                    panel.imagePosition,
                    isActive ? "scale-none" : "scale-[1.025]",
                  ].join(" ")}
                />

                <div
                  className={[
                    "pointer-events-none absolute inset-0 transition-colors duration-500 motion-reduce:transition-none",
                    isActive
                      ? "bg-linear-to-t from-slate-button-dark/92 via-slate-button-dark/20 to-slate-button-dark/5"
                      : "bg-slate-button-dark/45 lg:bg-linear-to-t lg:from-slate-button-dark/82 lg:via-slate-button-dark/30 lg:to-slate-button-dark/10",
                  ].join(" ")}
                />

                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-5 text-white sm:p-6">
                  <div className="flex items-end gap-4 lg:block">
                    <span className="font-mono text-xs tabular-nums text-white/62">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3
                      id={titleId}
                      className={[
                        "text-balance font-medium tracking-[-0.025em] transition-[font-size] duration-500 motion-reduce:transition-none",
                        isActive ? "text-3xl sm:text-4xl" : "text-lg lg:text-xl",
                      ].join(" ")}
                    >
                      {panel.title}
                    </h3>
                  </div>
                  <p
                    id={contentId}
                    aria-hidden={!isActive}
                    className={[
                      "max-w-[39rem] overflow-hidden text-pretty text-base leading-7 text-white/78 transition-[max-height,opacity,margin] duration-500 motion-reduce:transition-none",
                      isActive
                        ? "mt-3 max-h-28 opacity-100 delay-150 motion-reduce:delay-0"
                        : "mt-0 max-h-0 opacity-0",
                    ].join(" ")}
                  >
                    {panel.description}
                  </p>
                </div>

                <button
                  type="button"
                  aria-expanded={isActive}
                  aria-controls={contentId}
                  aria-labelledby={titleId}
                  onClick={() => setActivePanel(index)}
                  className="absolute inset-0 z-20 cursor-pointer rounded-radius-2xl outline-none focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-white"
                >
                  <span className="sr-only">
                    {isActive ? "Currently showing" : "Show"} {panel.title}
                  </span>
                </button>

                <span
                  aria-hidden="true"
                  className={[
                    "pointer-events-none absolute inset-x-0 bottom-0 z-30 h-1 origin-left bg-sky-blue-accent transition-transform duration-500 motion-reduce:transition-none",
                    isActive ? "scale-x-100" : "scale-x-0",
                  ].join(" ")}
                />
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

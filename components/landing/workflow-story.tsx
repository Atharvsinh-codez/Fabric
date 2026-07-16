import Image from "next/image";

import { Reveal } from "@/components/reveal";

const steps = [
  {
    number: "01",
    title: "Gather the whole story",
    body: "Bring research, notes, screenshots, and diagrams into one place while every source keeps its context.",
    image: "/images/fabric-gather-story-v1.webp",
    imageAlt: "Two collaborators arrange photographs and diagrams into clear groups on a sunlit table.",
    imagePosition: "object-center",
    details: [
      ["Place anything", "Arrange the work spatially without forcing it into a template."],
      ["Trace the source", "Keep the original evidence close to the idea it shaped."],
    ],
  },
  {
    number: "02",
    title: "Keep moving anywhere",
    body: "Open a board you have already visited, keep shaping the work, and let Fabric reconcile it when the signal returns.",
    image: "/images/fabric-offline-fieldwork.webp",
    imageAlt: "A researcher working from a tablet beside a train window.",
    imagePosition: "object-[58%_center]",
    details: [
      ["Local first", "Your actions appear immediately on your device."],
      ["Quiet recovery", "Reconnection happens without taking over the workspace."],
    ],
  },
] as const;

export function WorkflowStory() {
  return (
    <section id="workspace" className="scroll-mt-24 bg-white pb-24 sm:pb-32" aria-labelledby="workflow-story-title">
      <div id="why-fabric" className="mx-auto grid w-full max-w-7xl scroll-mt-24 items-center gap-10 px-5 pt-20 sm:px-8 sm:pt-28 lg:grid-cols-2 lg:gap-20 lg:px-10">
        <Reveal>
          <p className="text-sm font-semibold tracking-[0.12em] text-[#0084d1] uppercase">Why Fabric exists</p>
          <h2 className="mt-5 max-w-[14ch] text-balance font-display text-[clamp(2.75rem,4.5vw,4.25rem)] leading-[0.98] font-medium tracking-[-0.035em] text-[#252b31]">
            Team thinking should not feel like a black box.
          </h2>
          <p className="mt-7 max-w-[36rem] text-pretty text-lg leading-8 text-[#6b7280]">
            Good decisions rarely begin in one neat document. Fabric gives the fragments a shared place, so the path from evidence to outcome stays visible.
          </p>
        </Reveal>

        <Reveal delay={90} className="relative aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-[#e8f3f8] ring-1 ring-[#252b31]/6">
          <Image
            src="/images/fabric-why-story-v1.webp"
            alt="Raw research fragments connected across a bright white editorial workspace."
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </Reveal>
      </div>

      <Reveal
        id="how-it-works"
        className="mx-auto scroll-mt-24 px-5 pt-28 text-center sm:px-8 sm:pt-40 lg:px-10"
      >
        <p className="text-sm font-semibold tracking-[0.12em] text-[#0084d1] uppercase">How it works</p>
        <h2
          id="workflow-story-title"
          className="mx-auto mt-5 max-w-[18ch] text-balance font-display text-[clamp(3rem,5vw,4.75rem)] leading-[0.98] font-medium tracking-[-0.04em] text-[#252b31]"
        >
          Built for clarity, not guesswork.
        </h2>
      </Reveal>

      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10">
        {steps.map((step, index) => (
          <article
            key={step.number}
            className="grid items-center gap-10 pt-24 sm:pt-32 lg:grid-cols-12 lg:gap-16 lg:pt-40"
          >
            <Reveal
              className={[
                "lg:col-span-5",
                index === 1 ? "lg:order-2 lg:col-start-8" : "lg:col-start-1",
              ].join(" ")}
            >
              <p className="text-sm font-semibold tracking-[0.12em] text-[#0084d1] uppercase">Step {step.number}</p>
              <h3 className="mt-5 max-w-[13ch] text-balance font-display text-[clamp(2.6rem,4vw,4rem)] leading-[0.98] font-medium tracking-[-0.035em] text-[#252b31]">
                {step.title}
              </h3>
              <p className="mt-6 max-w-[35rem] text-pretty text-lg leading-8 text-[#6b7280]">{step.body}</p>

              <dl className="mt-9 grid gap-7 sm:grid-cols-2">
                {step.details.map(([term, description]) => (
                  <div key={term} className="border-t border-[#e6e6e6] pt-5">
                    <dt className="font-semibold text-[#252b31]">{term}</dt>
                    <dd className="mt-2 text-sm leading-6 text-[#6b7280]">{description}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>

            <Reveal
              delay={90}
              className={[
                "relative aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-[#edf4f8] ring-1 ring-[#252b31]/6 lg:col-span-7",
                index === 1 ? "lg:order-1 lg:col-start-1" : "lg:col-start-6",
              ].join(" ")}
            >
              <Image
                src={step.image}
                alt={step.imageAlt}
                fill
                sizes="(min-width: 1024px) 58vw, 100vw"
                className={`object-cover ${step.imagePosition}`}
              />
            </Reveal>
          </article>
        ))}
      </div>
    </section>
  );
}

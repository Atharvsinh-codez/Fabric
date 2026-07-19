import { ArrowRightIcon } from "@heroicons/react/20/solid";
import Image from "next/image";
import Link from "next/link";

import {
  landingActionIconStyles,
  landingActionStyles,
} from "@/components/landing/action-styles";
import { Reveal } from "@/components/reveal";

export function ConnectedEvidenceSection() {
  return (
    <section className="bg-white px-4 py-16 sm:px-7 sm:py-24" aria-labelledby="connected-evidence-title">
      <Reveal className="relative mx-auto min-h-[34rem] max-w-[90rem] overflow-hidden rounded-[1.75rem] bg-[#e8f3f8] ring-1 ring-[#252b31]/6 sm:min-h-[42rem] sm:rounded-[2rem]">
        <Image
          src="/images/fabric-connected-evidence-v1.webp"
          alt="Research fragments and botanical samples linked by a fine blue thread in a bright editorial composition."
          fill
          sizes="(max-width: 1536px) 100vw, 1440px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-white/10" />
        <div className="relative flex min-h-[34rem] flex-col items-center justify-center px-6 py-16 text-center sm:min-h-[42rem] sm:px-10">
          <p className="text-sm font-semibold tracking-[0.12em] text-[#0084d1] uppercase">Connected evidence</p>
          <h2
            id="connected-evidence-title"
            className="mt-5 max-w-[13ch] text-balance font-display text-[clamp(3.1rem,5.8vw,5.5rem)] leading-[0.95] font-medium tracking-[-0.04em] text-[#252b31]"
          >
            A board that remembers why.
          </h2>
          <p className="mt-6 max-w-[40rem] text-pretty text-lg leading-8 text-[#52606b]">
            Keep the source material, discussion, and decision close enough to inspect at a glance.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

export function StartWorkingSection() {
  return (
    <section className="bg-white px-4 py-16 sm:px-7 sm:py-24" aria-labelledby="start-working-title">
      <Reveal className="relative mx-auto min-h-[34rem] max-w-[90rem] overflow-hidden rounded-[1.75rem] bg-[#dceefa] ring-1 ring-[#252b31]/6 sm:min-h-[42rem] sm:rounded-[2rem]">
        <Image
          src="/images/fabric-start-working-v1.webp"
          alt="A bright open meadow framed by delicate spring flowers and a soft blue sky."
          fill
          sizes="(max-width: 1536px) 100vw, 1440px"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-white/12" />
        <div className="relative flex min-h-[34rem] flex-col items-center justify-center px-6 py-16 text-center sm:min-h-[42rem] sm:px-10">
          <p className="text-sm font-semibold tracking-[0.12em] text-[#0084d1] uppercase">Start working</p>
          <h2
            id="start-working-title"
            className="mt-5 max-w-[13ch] text-balance font-display text-[clamp(3.1rem,5.8vw,5.5rem)] leading-[0.95] font-medium tracking-[-0.04em] text-[#252b31]"
          >
            Turn the mess into a decision.
          </h2>
          <p className="mt-6 max-w-[42rem] text-pretty text-lg leading-8 text-[#52606b]">
            Take the board offline, review an AI proposal, and follow every decision back to its evidence.
          </p>
          <Link
            href="/app"
            className={`mt-8 ${landingActionStyles.primaryLarge}`}
          >
            Get started
            <ArrowRightIcon
              className={landingActionIconStyles.primary}
              aria-hidden="true"
            />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

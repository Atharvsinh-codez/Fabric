import { ArrowDownIcon, ArrowRightIcon } from "@heroicons/react/20/solid";
import Image from "next/image";
import Link from "next/link";

export function LandingHero() {
  return (
    <section
      data-landing-hero
      className="relative isolate flex min-h-[43rem] overflow-hidden bg-[#d8effb] sm:min-h-[47rem]"
      aria-labelledby="landing-hero-title"
    >
      <span id="landing-header-threshold" className="pointer-events-none absolute top-6 left-0 size-px" aria-hidden="true" />
      <Image
        src="/images/fabric-hero-soft-v1.webp"
        alt="Rolling green hills and spring flowers beneath an open blue sky."
        fill
        priority
        sizes="100vw"
        className="-z-20 object-cover object-center"
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center px-5 pt-32 pb-16 text-center sm:px-8 sm:pt-36 lg:px-10 lg:pt-40">
        <div className="hero-copy-enter flex max-w-5xl flex-col items-center">
          <p className="mb-6 rounded-full bg-white/72 px-4 py-2 text-sm font-medium text-[#35414b] ring-1 ring-white/80 backdrop-blur-md sm:mb-7">
            For teams who want clear decisions, without the guesswork
          </p>
          <h1
            id="landing-hero-title"
            className="max-w-[20ch] text-balance font-display text-[clamp(3.25rem,6vw,5.25rem)] leading-[0.96] font-medium tracking-[-0.04em] text-[#252b31]"
          >
            Turn scattered thinking into shared direction.
          </h1>
          <p className="mt-6 max-w-[48rem] text-pretty text-[1.0625rem] leading-7 text-[#465560] sm:mt-7 sm:text-lg">
            Bring research, notes, images, and decisions into one living canvas your whole team can shape together.
          </p>
          <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <Link
              href="/app"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-[#252b31] px-6 text-base font-semibold text-white outline-none transition-transform hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-sky-blue-accent"
            >
              Get started
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="#how-it-works"
              className="group inline-flex h-12 items-center gap-2 rounded-full px-3 text-base font-semibold text-[#252b31] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-sky-blue-accent"
            >
              Explore Fabric
              <ArrowDownIcon
                className="size-4 transition-transform group-hover:translate-y-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

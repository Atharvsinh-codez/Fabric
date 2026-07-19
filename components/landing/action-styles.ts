const stableActionInteraction =
  "outline-none transition-[background-color,color,box-shadow,transform] duration-200 ease-out motion-safe:active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-sky-blue-accent";

const primaryActionSurface =
  "bg-slate-button-dark text-surface-white shadow-[0_5px_16px_rgb(27_29_34/0.16),inset_0_1px_0_rgb(255_255_255/0.14)] ring-1 ring-slate-button-dark/90 hover:bg-near-black-primary-text hover:shadow-[0_8px_22px_rgb(27_29_34/0.22),inset_0_1px_0_rgb(255_255_255/0.16)] active:shadow-[0_3px_10px_rgb(27_29_34/0.16)]";

export const landingActionStyles = {
  primaryLarge: `${stableActionInteraction} ${primaryActionSurface} group inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full py-3 pr-4 pl-5 text-base font-semibold whitespace-nowrap`,
  primaryCompact: `${stableActionInteraction} ${primaryActionSurface} inline-flex h-10 shrink-0 items-center justify-center rounded-full px-5 text-sm font-semibold whitespace-nowrap`,
  glassCompact: `${stableActionInteraction} relative hidden h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-white/68 py-2 pr-3 pl-2 text-sm font-medium whitespace-nowrap text-[#35414b] shadow-[0_4px_14px_rgb(37_43_49/0.07)] ring-1 ring-white/75 backdrop-blur-md hover:bg-white hover:text-near-black-primary-text hover:shadow-[0_7px_20px_rgb(37_43_49/0.12)] hover:ring-white sm:inline-flex`,
  secondaryLarge: `${stableActionInteraction} group inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white/0 py-3 pr-3 pl-4 text-base font-semibold whitespace-nowrap text-[#252b31] ring-1 ring-transparent hover:bg-white/38 hover:text-[#17202a] hover:shadow-[0_6px_18px_rgb(37_43_49/0.08)] hover:ring-white/65`,
} as const;

export const landingActionIconStyles = {
  primary:
    "size-4 shrink-0 opacity-90 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none",
  secondaryShell:
    "grid size-6 shrink-0 place-items-center rounded-full bg-white/45 text-[#252b31] ring-1 ring-white/55 transition-[background-color,color,box-shadow] duration-200 group-hover:bg-white group-hover:text-sky-blue-accent group-hover:shadow-[0_3px_10px_rgb(37_43_49/0.08)] motion-reduce:transition-none",
} as const;

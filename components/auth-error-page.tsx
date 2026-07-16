import Image from "next/image";
import Link from "next/link";

import { FabricLogo } from "@/components/ui";

export type AuthErrorKind = "account" | "access" | "session" | "provider";

const authErrorCopy: Record<AuthErrorKind, string> = {
  account:
    "That provider could not be connected safely. Confirm both providers use the same verified email, then try again.",
  access:
    "This account cannot access Fabric right now. Contact your workspace administrator if you believe this is a mistake.",
  session: "Fabric could not verify your session. Wait a moment, then try signing in again.",
  provider: "The provider did not complete the sign-in request. Try again or choose the other provider.",
};

export function AuthErrorPage({
  kind,
  returnTo,
}: {
  kind: AuthErrorKind;
  returnTo: string;
}) {
  return (
    <main className="isolate min-h-dvh bg-surface-white font-sans text-near-black-primary-text">
      <div className="mx-auto grid min-h-dvh max-w-7xl lg:grid-cols-[5fr_7fr]">
        <aside className="relative hidden overflow-hidden bg-slate-button-dark px-10 py-9 lg:flex lg:flex-col lg:justify-between xl:px-14 xl:py-12">
          <Image
            src="/images/fabric-hills-reference-v3.webp"
            alt=""
            fill
            sizes="(min-width: 1024px) 42vw, 0px"
            className="object-cover outline-1 -outline-offset-1 outline-black/10"
          />
          <div className="absolute inset-0 bg-linear-to-b from-black/5 via-black/15 to-black/60" aria-hidden="true" />
          <Link
            href="/"
            aria-label="Fabric home"
            className="relative w-fit rounded-radius-pill bg-surface-white/90 px-4 py-2 shadow-sm backdrop-blur-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-white"
          >
            <FabricLogo />
          </Link>

          <div className="relative grid max-w-[36ch] gap-5">
            <p className="font-mono text-sm font-medium tracking-wide text-surface-white/80">
              PRIVATE BY DEFAULT
            </p>
            <h2 className="max-w-[18ch] text-balance font-display text-5xl font-normal text-surface-white">
              Your work stays behind a verified session.
            </h2>
            <p className="max-w-[44ch] text-base text-pretty text-surface-white/80">
              Fabric fails closed when it cannot verify an identity or an active account.
            </p>
          </div>

          <p className="relative text-sm text-surface-white/70">Provider details and private tokens are never shown here.</p>
        </aside>

        <section className="flex min-w-0 flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-9 xl:px-24 xl:py-12">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              aria-label="Fabric home"
              className="rounded-radius-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent lg:hidden"
            >
              <FabricLogo />
            </Link>
          </div>

          <div className="flex flex-1 items-center justify-center py-12 sm:py-16">
            <div className="grid w-full max-w-xs gap-8">
              <div className="grid gap-3">
                <p className="font-mono text-sm font-medium tracking-wide text-muted-gray">SIGN-IN INTERRUPTED</p>
                <h1 className="max-w-[35ch] text-3xl font-semibold tracking-tight text-balance text-near-black-primary-text">
                  We could not sign you in
                </h1>
                <p className="max-w-[48ch] text-base text-pretty text-dark-text-alt sm:text-sm">
                  {authErrorCopy[kind]}
                </p>
              </div>

              <div className="grid gap-3">
                <Link
                  href={{ pathname: "/login", query: { returnTo } }}
                  className="flex h-12 items-center justify-center rounded-radius-md bg-sky-blue-accent px-3 font-medium text-surface-white ring-1 ring-sky-blue-accent outline-none motion-safe:transition-transform motion-safe:duration-200 hover:bg-sky-blue-accent/90 active:scale-[0.99] active:bg-sky-blue-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-10"
                >
                  Try Sign-In Again
                </Link>
                <p className="text-center text-base text-dark-text-alt sm:text-sm">
                  <Link
                    href="/"
                    className="font-medium text-sky-blue-accent underline decoration-black/20 underline-offset-4 outline-none hover:decoration-sky-blue-accent focus-visible:rounded-radius-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                  >
                    Return Home
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";

import { OAuthProviderButtons } from "@/components/oauth-provider-buttons";
import { FabricLogo } from "@/components/ui";

type AuthMode = "login" | "signup";

export function AuthPage({ mode, returnTo }: { mode: AuthMode; returnTo: string }) {
  const isSignup = mode === "signup";
  const title = isSignup ? "Create your workspace" : "Welcome back";
  const description = isSignup
    ? "Start a shared canvas for research, decisions, and plans."
    : "Sign in to return to your boards and collaborators.";

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
              SHARED THINKING, IN CONTEXT
            </p>
            <h2 className="max-w-[18ch] text-balance font-display text-5xl font-normal text-surface-white">
              Keep the evidence beside the decision.
            </h2>
            <p className="max-w-[44ch] text-pretty text-base text-surface-white/80">
              Fabric brings notes, screenshots, diagrams, comments, and AI-assisted synthesis into one multiplayer canvas.
            </p>
          </div>

          <p className="relative text-sm text-surface-white/70">Local-first by design. Human-approved by default.</p>
        </aside>

        <section className="flex min-w-0 flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-9 xl:px-24 xl:py-12">
          <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:items-center lg:flex lg:justify-end">
            <Link
              href="/"
              aria-label="Fabric home"
              className="rounded-radius-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent lg:hidden"
            >
              <FabricLogo />
            </Link>
            <p className="text-base text-dark-text-alt sm:justify-self-end sm:text-right sm:text-sm">
              {isSignup ? "Already have an account?" : "New to Fabric?"}{" "}
              <Link
                href={{
                  pathname: isSignup ? "/login" : "/signup",
                  query: { returnTo },
                }}
                className="font-medium text-sky-blue-accent underline decoration-black/20 underline-offset-4 outline-none hover:decoration-sky-blue-accent focus-visible:rounded-radius-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
              >
                {isSignup ? "Sign In" : "Create Account"}
              </Link>
            </p>
          </div>

          <div className="flex flex-1 items-center justify-center py-12 sm:py-16">
            <div className="grid w-full max-w-xs gap-8">
              <div className="grid gap-3">
                <h1 className="max-w-[35ch] text-3xl font-semibold tracking-tight text-balance text-near-black-primary-text">
                  {title}
                </h1>
                <p className="max-w-[48ch] text-base text-pretty text-dark-text-alt sm:text-sm">
                  {description}
                </p>
              </div>

              <OAuthProviderButtons returnTo={returnTo} />

              <div className="grid gap-2 border-t border-border-subtle pt-5">
                <p className="text-base text-pretty text-dark-text-alt sm:text-sm">
                  By continuing, you acknowledge the{" "}
                  <Link
                    href="/privacy"
                    className="font-medium text-near-black-primary-text underline decoration-black/20 underline-offset-4 outline-none hover:decoration-near-black-primary-text focus-visible:rounded-radius-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>
                <p className="text-base text-pretty text-muted-gray sm:text-sm">
                  Verified Google and GitHub profiles with the same email open the same Fabric account.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

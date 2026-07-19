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
      <div
        data-auth-shell
        className="grid min-h-dvh w-full lg:grid-cols-[minmax(26rem,5fr)_minmax(0,7fr)]"
      >
        <aside
          data-auth-visual
          className="relative hidden overflow-hidden bg-slate-button-dark px-10 py-9 lg:flex lg:flex-col lg:justify-between xl:px-14 xl:py-12"
        >
          <Image
            src="/images/fabric-hills-reference-v3.webp"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 42vw, 0px"
            className="auth-visual-enter object-cover motion-reduce:animate-none"
          />
          <div className="absolute inset-0 bg-linear-to-b from-black/5 via-black/15 to-black/65" aria-hidden="true" />
          <Link
            href="/"
            aria-label="Fabric home"
            className="auth-item-enter relative w-fit rounded-radius-pill bg-surface-white/90 px-4 py-2 shadow-sm backdrop-blur-md outline-none [--auth-enter-delay:100ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-white motion-reduce:animate-none"
          >
            <FabricLogo />
          </Link>

          <div className="auth-item-enter relative grid max-w-[36ch] gap-5 [--auth-enter-delay:180ms] motion-reduce:animate-none">
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

          <p className="auth-item-enter relative text-sm text-surface-white/70 [--auth-enter-delay:260ms] motion-reduce:animate-none">
            Local-first by design. Human-approved by default.
          </p>
        </aside>

        <section
          data-auth-content
          className="auth-content-enter flex min-w-0 flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-9 xl:px-24 xl:py-12 motion-reduce:animate-none"
        >
          <div className="auth-item-enter grid gap-5 [--auth-enter-delay:100ms] sm:grid-cols-[auto_1fr] sm:items-center lg:flex lg:justify-end motion-reduce:animate-none">
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
            <div className="auth-item-enter grid w-full max-w-xs gap-8 [--auth-enter-delay:180ms] motion-reduce:animate-none">
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

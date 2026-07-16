"use client";

import { useRef, useState, type FormEvent } from "react";
import { SiGithub, SiGoogle } from "react-icons/si";

import { beginOAuthSignIn } from "@/app/actions/auth";
import { cx } from "@/components/ui";

const providers = [
  { id: "google", label: "Google", Icon: SiGoogle },
  { id: "github", label: "GitHub", Icon: SiGithub },
] as const;

type OAuthProvider = (typeof providers)[number]["id"];

export function OAuthProviderButtons({ returnTo }: { returnTo: string }) {
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(null);
  const pendingProviderRef = useRef<OAuthProvider | null>(null);

  function startProviderSignIn(
    event: FormEvent<HTMLFormElement>,
    provider: OAuthProvider,
  ) {
    if (pendingProviderRef.current !== null) {
      event.preventDefault();
      return;
    }

    pendingProviderRef.current = provider;
    setPendingProvider(provider);
  }

  return (
    <div className="grid gap-3">
      {providers.map(({ id, label, Icon }) => {
        const isPending = pendingProvider === id;
        const isDisabled = pendingProvider !== null;

        return (
          <form
            key={id}
            action={beginOAuthSignIn}
            onSubmit={(event) => startProviderSignIn(event, id)}
          >
            <input type="hidden" name="provider" value={id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button
              type="submit"
              disabled={isDisabled}
              aria-busy={isPending}
              className="grid h-12 w-full grid-cols-[1rem_1fr_1rem] items-center gap-2 rounded-radius-md bg-surface-white py-2 pr-3 pl-2 text-base font-medium text-near-black-primary-text ring-1 ring-black/10 outline-none motion-safe:transition-transform motion-safe:duration-200 hover:bg-light-surface-tint active:scale-[0.99] active:bg-border-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent disabled:cursor-not-allowed disabled:bg-light-surface-tint disabled:text-muted-gray disabled:active:scale-100 aria-busy:cursor-wait sm:h-10 sm:py-1.5 sm:pr-2.5 sm:pl-1.5 sm:text-sm"
            >
              <Icon
                aria-hidden="true"
                className={cx(
                  "size-4 shrink-0 place-self-center",
                  isDisabled ? "fill-muted-gray" : "fill-near-black-primary-text",
                )}
              />
              <span className="min-w-0 truncate text-center" aria-live="polite">
                {isPending ? `Connecting to ${label}...` : `Continue with ${label}`}
              </span>
              <span aria-hidden="true" />
            </button>
          </form>
        );
      })}
    </div>
  );
}

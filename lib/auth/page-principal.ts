import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import {
  AccountSuspendedError,
  AuthenticationRequiredError,
  requirePrincipal,
  type Principal,
} from "@/lib/auth/require-principal";
import { APP_ROUTES } from "@/lib/app-routes";

/** Deduplicate the protected layout and page session lookup within one RSC request. */
export const requirePagePrincipal = cache(requirePrincipal);

export async function requireProtectedPagePrincipal(): Promise<Principal> {
  try {
    return await requirePagePrincipal();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/login?returnTo=%2Fapp");
    }

    if (error instanceof AccountSuspendedError) {
      redirect("/login/error?error=AccessDenied");
    }

    redirect("/login/error?error=SessionUnavailable");
  }
}

/** Keep authenticated accounts out of the public sign-in and sign-up screens. */
export async function redirectAuthenticatedPagePrincipal(): Promise<void> {
  try {
    await requirePagePrincipal();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return;

    if (error instanceof AccountSuspendedError) {
      redirect("/login/error?error=AccessDenied");
    }

    redirect("/login/error?error=SessionUnavailable");
  }

  redirect(APP_ROUTES.workspaces);
}

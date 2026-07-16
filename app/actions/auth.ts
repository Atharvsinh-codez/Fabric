"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/auth";
import { parseOAuthProvider } from "@/lib/auth/oauth-policy";
import { getSafeReturnPath } from "@/lib/auth/safe-return";

function safeErrorCode(error: AuthError): string {
  if (error.type === "OAuthAccountNotLinked") return "AccountNotLinked";
  if (error.type === "AccessDenied") return "AccessDenied";
  return "OAuthSignIn";
}

export async function beginOAuthSignIn(formData: FormData): Promise<void> {
  const returnTo = getSafeReturnPath(formData.get("returnTo")?.toString());
  const provider = parseOAuthProvider(formData.get("provider"));

  if (!provider) {
    const query = new URLSearchParams({ error: "OAuthSignIn", returnTo });
    redirect(`/login/error?${query.toString()}`);
  }

  try {
    await signIn(provider, { redirectTo: returnTo });
  } catch (error) {
    if (error instanceof AuthError) {
      const query = new URLSearchParams({
        error: safeErrorCode(error),
        returnTo,
      });
      redirect(`/login/error?${query.toString()}`);
    }

    throw error;
  }
}

export async function signOutCurrentSession(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

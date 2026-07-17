import type { Metadata } from "next";

import { AuthErrorPage, type AuthErrorKind } from "@/components/auth-error-page";
import { getSafeReturnPath } from "@/lib/auth/safe-return";

export const metadata: Metadata = {
  title: "Sign-In Interrupted",
  description: "Return to Fabric sign-in safely.",
  robots: { index: false, follow: false },
};

function getErrorKind(error: string | string[] | undefined): AuthErrorKind {
  const safeError = Array.isArray(error) ? error[0] : error;

  if (safeError === "OAuthAccountNotLinked" || safeError === "AccountNotLinked") return "account";
  if (safeError === "AccessDenied") return "access";
  if (safeError === "SessionUnavailable") return "session";
  return "provider";
}

export default async function LoginErrorPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const { error, returnTo } = await searchParams;

  return (
    <AuthErrorPage
      kind={getErrorKind(error)}
      returnTo={getSafeReturnPath(returnTo)}
    />
  );
}

import type { Metadata } from "next";

import { AuthPage } from "@/components/auth-pages";
import { redirectAuthenticatedPagePrincipal } from "@/lib/auth/page-principal";
import { getSafeReturnPath } from "@/lib/auth/safe-return";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Create a Fabric workspace for your team.",
  robots: { index: false, follow: false },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  await redirectAuthenticatedPagePrincipal();
  const { returnTo } = await searchParams;

  return (
    <AuthPage
      mode="signup"
      returnTo={getSafeReturnPath(returnTo, "/app/onboarding")}
    />
  );
}

import type { Metadata } from "next";

import { AuthPage } from "@/components/auth-pages";
import { redirectAuthenticatedPagePrincipal } from "@/lib/auth/page-principal";
import { getSafeReturnPath } from "@/lib/auth/safe-return";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your Fabric workspace.",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  await redirectAuthenticatedPagePrincipal();
  const { returnTo } = await searchParams;

  return <AuthPage mode="login" returnTo={getSafeReturnPath(returnTo)} />;
}

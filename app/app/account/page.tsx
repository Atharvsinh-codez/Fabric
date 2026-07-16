import type { Metadata } from "next";

import { AccountPage } from "@/components/account-page";
import { requireProtectedPagePrincipal } from "@/lib/auth/page-principal";
import { hasReadyPrivateMediaConfiguration } from "@/lib/health/deployment-readiness";
import { isUserWorkspaceRolloutEnabled } from "@/lib/rollout/workspace-rollout";

export const metadata: Metadata = {
  title: "Account",
  description: "Manage your Fabric profile, notifications, and sessions.",
};

export default async function AppAccountPage() {
  const principal = await requireProtectedPagePrincipal();
  const customAvatarEnabled =
    (await isUserWorkspaceRolloutEnabled(principal.id)) &&
    hasReadyPrivateMediaConfiguration(process.env);
  return <AccountPage customAvatarEnabled={customAvatarEnabled} />;
}

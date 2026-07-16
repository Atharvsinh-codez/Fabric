import type { ReactNode } from "react";

import { CurrentUserProvider } from "@/components/current-user-provider";
import { requireProtectedPagePrincipal } from "@/lib/auth/page-principal";

export const dynamic = "force-dynamic";

export default async function ProtectedAppLayout({ children }: { children: ReactNode }) {
  const principal = await requireProtectedPagePrincipal();

  return <CurrentUserProvider user={principal}>{children}</CurrentUserProvider>;
}

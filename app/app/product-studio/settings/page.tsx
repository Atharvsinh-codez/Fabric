import { permanentRedirect } from "next/navigation";

import {
  APP_ROUTES,
  withSearchParams,
  type RouteSearchParams,
} from "@/lib/app-routes";

export default async function LegacyProductStudioSettingsPage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  permanentRedirect(withSearchParams(APP_ROUTES.settings, await searchParams));
}

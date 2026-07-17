import { permanentRedirect } from "next/navigation";

import {
  APP_ROUTES,
  withSearchParams,
  type RouteSearchParams,
} from "@/lib/app-routes";

export default async function LegacyProductStudioPage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  permanentRedirect(withSearchParams(APP_ROUTES.dashboard, await searchParams));
}

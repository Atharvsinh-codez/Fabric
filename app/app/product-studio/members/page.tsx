import { permanentRedirect } from "next/navigation";

import {
  APP_ROUTES,
  withSearchParams,
  type RouteSearchParams,
} from "@/lib/app-routes";

export default async function LegacyProductStudioMembersPage({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  permanentRedirect(withSearchParams(APP_ROUTES.members, await searchParams));
}

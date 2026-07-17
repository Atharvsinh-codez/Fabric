import { permanentRedirect } from "next/navigation";

import {
  boardPath,
  withSearchParams,
  type RouteSearchParams,
} from "@/lib/app-routes";

export default async function LegacyProductStudioBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { boardId } = await params;
  permanentRedirect(withSearchParams(boardPath(boardId), await searchParams));
}

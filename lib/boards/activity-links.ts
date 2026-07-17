import { APP_ROUTES, boardPath, workspaceRoutePath } from "@/lib/app-routes";

export function boardActivityPath(boardId: string): string {
  return boardPath(boardId);
}

export function memberActivityPath(workspaceId: string): string {
  return workspaceRoutePath(APP_ROUTES.members, workspaceId);
}

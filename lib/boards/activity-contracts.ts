export const WORKSPACE_ACTIVITY_TYPES = ["Boards", "Comments", "Members"] as const;

export type WorkspaceActivityType = (typeof WORKSPACE_ACTIVITY_TYPES)[number];

export type WorkspaceActivityItem = Readonly<{
  id: string;
  type: WorkspaceActivityType;
  actorName: string | null;
  actorImage: string | null;
  action: string;
  target: string;
  targetHref: string;
  occurredAt: string;
}>;

export type WorkspaceActivityPage = Readonly<{
  items: WorkspaceActivityItem[];
  nextCursor: string | null;
}>;

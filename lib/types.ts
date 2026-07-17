import type { ComponentType, SVGProps } from "react";

export type ToolId =
  | "select"
  | "hand"
  | "rectangle"
  | "ellipse"
  | "text"
  | "note"
  | "connector"
  | "image"
  | "comment";

export type PanelId = "inspector" | "comments" | "ai" | null;

export type SyncState = "synced" | "saving" | "offline" | "reconnecting" | "partial";

export type NodeType =
  | "frame"
  | "note"
  | "text"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "hexagon"
  | "image"
  | "drawing"
  | "summary";

export type CanvasNode = {
  id: string;
  type: NodeType;
  title: string;
  body?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  textColor?: string;
  locked?: boolean;
  /** False when page-space containment cannot be proven from the durable projection. */
  viewportWriteSafe?: boolean;
  /** True when moving this node would also move one or more durable descendants. */
  hasDescendants?: boolean;
  parentId?: string;
  tag?: string;
  meta?: string;
};

export type CanvasEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  route: "straight" | "elbow";
};

export type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export type CommentThread = {
  id: string;
  nodeId: string;
  author: string;
  initials: string;
  color: string;
  body: string;
  time: string;
  resolved: boolean;
  replies: number;
};

export type ToolDefinition = {
  id: ToolId;
  title: string;
  shortcut: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export type ModalId = "share" | "export" | "checkpoint" | "shortcuts" | "list" | "templates" | null;

export type Toast = {
  id: number;
  message: string;
  action?: string;
};

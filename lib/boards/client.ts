import type {
  BoardAccessRole,
  BoardCoverMetadata,
  BoardDocument,
  BoardSharingPolicy,
  BoardStatus,
  CommentAnchor,
  ProjectIcon,
  ShareLinkPermission,
  WorkspaceRole,
} from "@/db/schema/product";
import type { BoardImageAssetSummary } from "@/lib/boards/assets/contracts";
import type { BoardTheme } from "@/lib/boards/board-theme";
import type { WorkspaceActivityPage } from "@/lib/boards/activity-contracts";

export type WorkspaceSummary = Readonly<{
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}>;

export type BoardSummary = Readonly<{
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string | null;
  ownerId: string;
  title: string;
  cover: BoardCoverMetadata | null;
  status: BoardStatus;
  sharingPolicy: BoardSharingPolicy;
  revision: number;
  documentGenerationId: string;
  role: WorkspaceRole;
  favorite: boolean;
  pinned: boolean;
  lastOpenedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type BoardListPage = Readonly<{
  boards: BoardSummary[];
  nextCursor: string | null;
}>;

export type BoardListQuery = Readonly<{
  workspaceId: string;
  view?: "recent" | "favorite" | "pinned" | "shared" | "archived" | "all";
  q?: string;
  projectId?: string;
  status?: BoardStatus;
  cursor?: string;
  limit?: number;
}>;

export type ProjectSummary = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
  icon: ProjectIcon;
  defaultSharingPolicy: BoardSharingPolicy;
  isDefault: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type BoardDetail = BoardSummary & Readonly<{ document: BoardDocument }>;

export type WorkspaceMember = Readonly<{
  userId: string;
  role: WorkspaceRole;
  name: string | null;
  email?: string | null;
  image: string | null;
  createdAt: string;
}>;

export type ScopedBoardMember = Readonly<{
  userId: string;
  role: BoardAccessRole;
  name: string | null;
  image: string | null;
  createdAt: string;
}>;

export type ProjectMember = ScopedBoardMember;
export type BoardMember = ScopedBoardMember;

export type BoardComment = Readonly<{
  id: string;
  threadId: string;
  authorId: string;
  authorName: string | null;
  authorImage: string | null;
  body: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}>;

export type BoardCommentThread = Readonly<{
  id: string;
  anchor: CommentAnchor;
  createdBy: string;
  creatorName: string | null;
  creatorImage: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  comments: BoardComment[];
}>;

export type PublicShareCommentAccess = Readonly<{
  permission: ShareLinkPermission;
  threads: BoardCommentThread[];
}>;

export type BoardShareLink = Readonly<{
  id: string;
  permission: ShareLinkPermission;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}>;

export type CreatedBoardShareLink = Readonly<{
  id: string;
  permission: ShareLinkPermission;
  expiresAt: string | null;
  createdAt: string;
  path: string;
}>;

export type BoardCheckpoint = Readonly<{
  id: string;
  boardId: string;
  name: string;
  sourceDocumentGenerationId: string;
  sourceRevision: number;
  createdBy: string;
  creatorName: string | null;
  creatorImage: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type RestoredBoardCheckpoint = Readonly<{
  id: string;
  document: BoardDocument;
  revision: number;
  documentGenerationId: string;
  updatedAt: string;
  role: WorkspaceRole;
}>;

type ApiErrorBody = Readonly<{
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}>;

export class FabricApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "FabricApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    throw new FabricApiError(
      response.status,
      body.error?.code ?? "request_failed",
      body.error?.message ?? "Fabric could not complete that request.",
      body.error?.details,
    );
  }

  return body;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const result = await requestJson<{ workspaces: WorkspaceSummary[] }>(
    "/api/boards/workspaces",
  );
  return result.workspaces;
}

export async function listWorkspaceActivity(input: {
  workspaceId: string;
  cursor?: string;
  limit?: number;
}): Promise<WorkspaceActivityPage> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const result = await requestJson<{ activity: WorkspaceActivityPage }>(
    `/api/boards/workspaces/${encodeURIComponent(input.workspaceId)}/activity${suffix}`,
  );
  return result.activity;
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const result = await requestJson<{ workspace: WorkspaceSummary }>(
    "/api/boards/workspaces",
    { method: "POST", body: JSON.stringify({ name }) },
  );
  return result.workspace;
}

export async function listWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const result = await requestJson<{ members: WorkspaceMember[] }>(
    `/api/boards/workspaces/${encodeURIComponent(workspaceId)}/members`,
  );
  return result.members;
}

export async function addWorkspaceMember(input: {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
}): Promise<WorkspaceMember> {
  const { workspaceId, ...body } = input;
  const result = await requestJson<{ member: WorkspaceMember }>(
    `/api/boards/workspaces/${encodeURIComponent(workspaceId)}/members`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return result.member;
}

export async function updateWorkspaceMember(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<{ userId: string; role: WorkspaceRole; updatedAt: string }> {
  const { workspaceId, userId, role } = input;
  const result = await requestJson<{
    member: { userId: string; role: WorkspaceRole; updatedAt: string };
  }>(
    `/api/boards/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  return result.member;
}

export async function removeWorkspaceMember(input: {
  workspaceId: string;
  userId: string;
}): Promise<{ userId: string }> {
  const result = await requestJson<{ member: { userId: string } }>(
    `/api/boards/workspaces/${encodeURIComponent(input.workspaceId)}/members/${encodeURIComponent(input.userId)}`,
    { method: "DELETE" },
  );
  return result.member;
}

export async function listBoardsPage(
  input: BoardListQuery,
): Promise<BoardListPage> {
  const query = new URLSearchParams({ workspaceId: input.workspaceId });
  if (input.view) query.set("view", input.view);
  if (input.q) query.set("q", input.q);
  if (input.projectId) query.set("projectId", input.projectId);
  if (input.status) query.set("status", input.status);
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  return requestJson<BoardListPage>(
    `/api/boards?${query}`,
  );
}

export async function listBoards(
  input: Omit<BoardListQuery, "cursor" | "limit">,
): Promise<BoardSummary[]> {
  return (await listBoardsPage(input)).boards;
}

export async function createBoard(input: {
  workspaceId: string;
  projectId?: string;
  title: string;
  theme?: BoardTheme;
  sharingPolicy?: BoardSharingPolicy;
  cover?: Extract<BoardCoverMetadata, { kind: "preset" }> | null;
  document?: BoardDocument;
}): Promise<BoardDetail> {
  const result = await requestJson<{ board: BoardDetail }>("/api/boards", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.board;
}

export async function getBoard(boardId: string): Promise<BoardDetail> {
  const result = await requestJson<{ board: BoardDetail }>(
    `/api/boards/${encodeURIComponent(boardId)}`,
  );
  return result.board;
}

export async function updateBoardDocument(input: {
  boardId: string;
  expectedRevision: number;
  expectedDocumentGenerationId: string;
  document: BoardDocument;
}): Promise<
  Pick<
    BoardDetail,
    "id" | "document" | "revision" | "documentGenerationId" | "updatedAt"
  >
> {
  const { boardId, ...body } = input;
  const result = await requestJson<{
    board: Pick<
      BoardDetail,
      "id" | "document" | "revision" | "documentGenerationId" | "updatedAt"
    >;
  }>(`/api/boards/${encodeURIComponent(boardId)}/document`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return result.board;
}

export async function archiveBoard(boardId: string): Promise<BoardSummary> {
  const result = await requestJson<{ board: BoardSummary }>(
    `/api/boards/${encodeURIComponent(boardId)}`,
    { method: "DELETE" },
  );
  return result.board;
}

export async function listBoardImageAssets(
  boardId: string,
): Promise<BoardImageAssetSummary[]> {
  const result = await requestJson<{ assets: BoardImageAssetSummary[] }>(
    `/api/boards/${encodeURIComponent(boardId)}/assets`,
  );
  return result.assets;
}

export type { BoardImageAssetSummary } from "@/lib/boards/assets/contracts";

export async function restoreBoard(boardId: string): Promise<BoardSummary> {
  const result = await requestJson<{ board: BoardSummary }>(
    `/api/boards/${encodeURIComponent(boardId)}/restore`,
    { method: "POST" },
  );
  return result.board;
}

export async function updateBoardMetadata(input: {
  boardId: string;
  title?: string;
  projectId?: string;
  ownerId?: string;
  status?: Exclude<BoardStatus, "archived">;
  sharingPolicy?: BoardSharingPolicy;
  cover?: BoardCoverMetadata | null;
}): Promise<BoardSummary> {
  const { boardId, ...body } = input;
  const result = await requestJson<{ board: BoardSummary }>(
    `/api/boards/${encodeURIComponent(boardId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  return result.board;
}

export async function updateBoardPreference(input: {
  boardId: string;
  favorite?: boolean;
  pinned?: boolean;
}): Promise<{ favorite: boolean; pinned: boolean }> {
  const { boardId, ...body } = input;
  const result = await requestJson<{
    preference: { favorite: boolean; pinned: boolean };
  }>(`/api/boards/${encodeURIComponent(boardId)}/preferences`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return result.preference;
}

export async function renameBoard(
  boardId: string,
  title: string,
): Promise<BoardSummary> {
  const result = await requestJson<{ board: BoardSummary }>(
    `/api/boards/${encodeURIComponent(boardId)}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
  );
  return result.board;
}

export async function listProjects(
  workspaceId: string,
): Promise<ProjectSummary[]> {
  const result = await requestJson<{ projects: ProjectSummary[] }>(
    `/api/boards/workspaces/${encodeURIComponent(workspaceId)}/projects`,
  );
  return result.projects;
}

export async function createProject(input: {
  workspaceId: string;
  name: string;
  icon?: ProjectIcon;
  defaultSharingPolicy?: BoardSharingPolicy;
}): Promise<ProjectSummary> {
  const { workspaceId, ...body } = input;
  const result = await requestJson<{ project: ProjectSummary }>(
    `/api/boards/workspaces/${encodeURIComponent(workspaceId)}/projects`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return result.project;
}

export async function updateProjectPreference(input: {
  workspaceId: string;
  projectId: string;
  pinned: boolean;
}): Promise<{ pinned: boolean }> {
  const result = await requestJson<{ preference: { pinned: boolean } }>(
    `/api/boards/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/preferences`,
    { method: "PATCH", body: JSON.stringify({ pinned: input.pinned }) },
  );
  return result.preference;
}

export async function listProjectMembers(input: {
  workspaceId: string;
  projectId: string;
}): Promise<ProjectMember[]> {
  const result = await requestJson<{ members: ProjectMember[] }>(
    `/api/boards/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/members`,
  );
  return result.members;
}

export async function addProjectMember(input: {
  workspaceId: string;
  projectId: string;
  email: string;
  role: BoardAccessRole;
}): Promise<ProjectMember> {
  const { workspaceId, projectId, ...body } = input;
  const result = await requestJson<{ member: ProjectMember }>(
    `/api/boards/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/members`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return result.member;
}

export async function updateProjectMember(input: {
  workspaceId: string;
  projectId: string;
  userId: string;
  role: BoardAccessRole;
}): Promise<{ userId: string; role: BoardAccessRole; updatedAt: string }> {
  const { workspaceId, projectId, userId, role } = input;
  const result = await requestJson<{
    member: { userId: string; role: BoardAccessRole; updatedAt: string };
  }>(
    `/api/boards/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  return result.member;
}

export async function removeProjectMember(input: {
  workspaceId: string;
  projectId: string;
  userId: string;
}): Promise<{ userId: string }> {
  const result = await requestJson<{ member: { userId: string } }>(
    `/api/boards/workspaces/${encodeURIComponent(input.workspaceId)}/projects/${encodeURIComponent(input.projectId)}/members/${encodeURIComponent(input.userId)}`,
    { method: "DELETE" },
  );
  return result.member;
}

export async function listBoardMembers(
  boardId: string,
): Promise<BoardMember[]> {
  const result = await requestJson<{ members: BoardMember[] }>(
    `/api/boards/${encodeURIComponent(boardId)}/members`,
  );
  return result.members;
}

export async function addBoardMember(input: {
  boardId: string;
  email: string;
  role: BoardAccessRole;
}): Promise<BoardMember> {
  const { boardId, ...body } = input;
  const result = await requestJson<{ member: BoardMember }>(
    `/api/boards/${encodeURIComponent(boardId)}/members`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return result.member;
}

export async function updateBoardMember(input: {
  boardId: string;
  userId: string;
  role: BoardAccessRole;
}): Promise<{ userId: string; role: BoardAccessRole; updatedAt: string }> {
  const { boardId, userId, role } = input;
  const result = await requestJson<{
    member: { userId: string; role: BoardAccessRole; updatedAt: string };
  }>(
    `/api/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  return result.member;
}

export async function removeBoardMember(input: {
  boardId: string;
  userId: string;
}): Promise<{ userId: string }> {
  const result = await requestJson<{ member: { userId: string } }>(
    `/api/boards/${encodeURIComponent(input.boardId)}/members/${encodeURIComponent(input.userId)}`,
    { method: "DELETE" },
  );
  return result.member;
}

export async function listBoardCommentThreads(
  boardId: string,
  signal?: AbortSignal,
): Promise<BoardCommentThread[]> {
  const result = await requestJson<{ threads: BoardCommentThread[] }>(
    `/api/boards/${encodeURIComponent(boardId)}/comments`,
    { signal },
  );
  return result.threads;
}

export async function createBoardCommentThread(input: {
  boardId: string;
  anchor: CommentAnchor;
  body: string;
}): Promise<void> {
  await requestJson(
    `/api/boards/${encodeURIComponent(input.boardId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({
        kind: "thread",
        anchor: input.anchor,
        body: input.body,
      }),
    },
  );
}

export async function replyToBoardCommentThread(input: {
  boardId: string;
  threadId: string;
  body: string;
}): Promise<void> {
  await requestJson(
    `/api/boards/${encodeURIComponent(input.boardId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({
        kind: "reply",
        threadId: input.threadId,
        body: input.body,
      }),
    },
  );
}

export async function setBoardCommentThreadResolution(input: {
  boardId: string;
  threadId: string;
  resolved: boolean;
}): Promise<void> {
  await requestJson(
    `/api/boards/${encodeURIComponent(input.boardId)}/comments/${encodeURIComponent(input.threadId)}`,
    { method: "PATCH", body: JSON.stringify({ resolved: input.resolved }) },
  );
}

export async function listPublicShareCommentThreads(
  token: string,
  signal?: AbortSignal,
): Promise<PublicShareCommentAccess> {
  return requestJson<PublicShareCommentAccess>(
    `/api/shares/${encodeURIComponent(token)}/comments`,
    { signal },
  );
}

export async function createPublicShareCommentThread(input: {
  token: string;
  anchor: CommentAnchor;
  body: string;
}): Promise<void> {
  await requestJson(`/api/shares/${encodeURIComponent(input.token)}/comments`, {
    method: "POST",
    body: JSON.stringify({
      kind: "thread",
      anchor: input.anchor,
      body: input.body,
    }),
  });
}

export async function replyToPublicShareCommentThread(input: {
  token: string;
  threadId: string;
  body: string;
}): Promise<void> {
  await requestJson(`/api/shares/${encodeURIComponent(input.token)}/comments`, {
    method: "POST",
    body: JSON.stringify({
      kind: "reply",
      threadId: input.threadId,
      body: input.body,
    }),
  });
}

export async function listBoardShareLinks(
  boardId: string,
  signal?: AbortSignal,
): Promise<BoardShareLink[]> {
  const result = await requestJson<{ links: BoardShareLink[] }>(
    `/api/boards/${encodeURIComponent(boardId)}/share-links`,
    { signal },
  );
  return result.links.map((link) => ({
    id: link.id,
    permission: link.permission,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    lastUsedAt: link.lastUsedAt,
    createdAt: link.createdAt,
  }));
}

export async function createBoardShareLink(input: {
  boardId: string;
  permission: ShareLinkPermission;
  expiresAt?: string | null;
}): Promise<CreatedBoardShareLink> {
  const result = await requestJson<{ link: CreatedBoardShareLink }>(
    `/api/boards/${encodeURIComponent(input.boardId)}/share-links`,
    {
      method: "POST",
      body: JSON.stringify({
        permission: input.permission,
        expiresAt: input.expiresAt ?? null,
      }),
    },
  );
  return {
    id: result.link.id,
    permission: result.link.permission,
    expiresAt: result.link.expiresAt,
    createdAt: result.link.createdAt,
    path: result.link.path,
  };
}

export async function revokeBoardShareLink(input: {
  boardId: string;
  linkId: string;
}): Promise<void> {
  await requestJson(
    `/api/boards/${encodeURIComponent(input.boardId)}/share-links/${encodeURIComponent(input.linkId)}`,
    { method: "DELETE" },
  );
}

function redactCheckpointSnapshot(
  checkpoint: BoardCheckpoint,
): BoardCheckpoint {
  return {
    id: checkpoint.id,
    boardId: checkpoint.boardId,
    name: checkpoint.name,
    sourceDocumentGenerationId: checkpoint.sourceDocumentGenerationId,
    sourceRevision: checkpoint.sourceRevision,
    createdBy: checkpoint.createdBy,
    creatorName: checkpoint.creatorName,
    creatorImage: checkpoint.creatorImage,
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.updatedAt,
  };
}

export async function listBoardCheckpoints(
  boardId: string,
  signal?: AbortSignal,
): Promise<BoardCheckpoint[]> {
  const result = await requestJson<{ checkpoints: BoardCheckpoint[] }>(
    `/api/boards/${encodeURIComponent(boardId)}/checkpoints`,
    { signal },
  );
  return result.checkpoints.map(redactCheckpointSnapshot);
}

export async function createBoardCheckpoint(input: {
  boardId: string;
  name: string;
}): Promise<BoardCheckpoint> {
  const result = await requestJson<{ checkpoint: BoardCheckpoint }>(
    `/api/boards/${encodeURIComponent(input.boardId)}/checkpoints`,
    { method: "POST", body: JSON.stringify({ name: input.name }) },
  );
  return redactCheckpointSnapshot(result.checkpoint);
}

export async function restoreBoardCheckpoint(input: {
  boardId: string;
  checkpointId: string;
}): Promise<RestoredBoardCheckpoint> {
  const result = await requestJson<{ board: RestoredBoardCheckpoint }>(
    `/api/boards/${encodeURIComponent(input.boardId)}/checkpoints/${encodeURIComponent(input.checkpointId)}/restore`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return {
    id: result.board.id,
    document: result.board.document,
    revision: result.board.revision,
    documentGenerationId: result.board.documentGenerationId,
    updatedAt: result.board.updatedAt,
    role: result.board.role,
  };
}

import { z } from "zod";

import {
  BOARD_ACCESS_ROLES,
  BOARD_COVER_PRESETS,
  BOARD_SHARING_POLICIES,
  BOARD_STATUSES,
  PROJECT_ICONS,
  SHARE_LINK_PERMISSIONS,
  WORKSPACE_ROLES,
  type BoardCoverMetadata,
  type BoardDocument,
} from "../../db/schema/product";
import { BOARD_CHECKPOINT_NAME_MAX_LENGTH } from "../../db/schema/checkpoints";
import {
  BOARD_LIST_DEFAULT_PAGE_SIZE,
  BOARD_LIST_MAX_PAGE_SIZE,
  PAGINATION_CURSOR_MAX_CHARS,
} from "./pagination-contract";
import { BOARD_THEMES } from "./board-theme";

const MAX_JSON_DEPTH = 48;
const MAX_JSON_ENTRIES = 25_000;
const MAX_KEY_LENGTH = 256;

export const BOARD_DOCUMENT_MAX_BYTES = 1_000_000;
export const DEFAULT_API_BODY_MAX_BYTES = 32_000;

export const UuidSchema = z.string().uuid();
export const PublicShareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const WorkspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export const BoardAccessRoleSchema = z.enum(BOARD_ACCESS_ROLES);
export const BoardStatusSchema = z.enum(BOARD_STATUSES);
export const BoardSharingPolicySchema = z.enum(BOARD_SHARING_POLICIES);
export const BoardThemeSchema = z.enum(BOARD_THEMES);
export const ProjectIconSchema = z.enum(PROJECT_ICONS);
export const ShareLinkPermissionSchema = z.enum(SHARE_LINK_PERMISSIONS);

export const BoardCoverPresetSchema = z
  .object({
    kind: z.literal("preset"),
    value: z.enum(BOARD_COVER_PRESETS),
  })
  .strict();

export const BoardCoverSchema = z
  .discriminatedUnion("kind", [
    BoardCoverPresetSchema,
    z.object({ kind: z.literal("asset"), assetId: UuidSchema }).strict(),
  ])
  .transform((value) => value as BoardCoverMetadata);

function inspectJson(value: unknown): string | null {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let entries = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    entries += 1;
    if (entries > MAX_JSON_ENTRIES) return "The document contains too many values.";
    if (current.depth > MAX_JSON_DEPTH) return "The document is nested too deeply.";

    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return "The document contains a non-finite number.";
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (typeof current.value === "object") {
      const prototype = Object.getPrototypeOf(current.value);
      if (prototype !== Object.prototype && prototype !== null) {
        return "The document contains an unsupported object.";
      }
      for (const [key, item] of Object.entries(current.value)) {
        if (key.length > MAX_KEY_LENGTH) return "The document contains an overlong key.";
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          return "The document contains a reserved key.";
        }
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    return "The document contains a value that cannot be stored as JSON.";
  }

  return null;
}

export const BoardDocumentSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, context) => {
    const issue = inspectJson(value);
    if (issue) context.addIssue({ code: "custom", message: issue });
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > BOARD_DOCUMENT_MAX_BYTES) {
      context.addIssue({ code: "custom", message: "The board document is too large." });
    }
  })
  .transform((value) => value as BoardDocument);

const NonnegativeRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const DeleteWorkspaceSchema = z
  .object({
    expectedName: z.string().min(1).max(120),
  })
  .strict();

export const CreateBoardSchema = z.object({
  workspaceId: UuidSchema,
  projectId: UuidSchema.optional(),
  title: z.string().trim().min(1).max(160),
  theme: BoardThemeSchema.optional(),
  sharingPolicy: BoardSharingPolicySchema.optional(),
  cover: BoardCoverPresetSchema.nullable().optional(),
  document: BoardDocumentSchema.optional(),
}).strict();

export const BOARD_LIST_VIEWS = [
  "recent",
  "favorite",
  "pinned",
  "shared",
  "archived",
  "all",
] as const;
export const BoardListViewSchema = z.enum(BOARD_LIST_VIEWS);

export const ListBoardsQuerySchema = z
  .object({
    workspaceId: UuidSchema,
    view: BoardListViewSchema.default("recent"),
    q: z.string().trim().max(160).optional(),
    projectId: UuidSchema.optional(),
    status: BoardStatusSchema.optional(),
    cursor: z.string().min(1).max(PAGINATION_CURSOR_MAX_CHARS).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(BOARD_LIST_MAX_PAGE_SIZE)
      .default(BOARD_LIST_DEFAULT_PAGE_SIZE),
  })
  .strict();

export const UpdateBoardMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    projectId: UuidSchema.optional(),
    ownerId: UuidSchema.optional(),
    status: z.enum(["draft", "active", "review", "approved"]).optional(),
    sharingPolicy: BoardSharingPolicySchema.optional(),
    cover: BoardCoverSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one board field is required.",
  });

export const DeleteBoardSchema = z
  .object({
    expectedTitle: z.string().min(1).max(160),
    expectedDocumentGenerationId: UuidSchema,
  })
  .strict();

export const UpdateBoardPreferenceSchema = z
  .object({
    favorite: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.favorite !== undefined || value.pinned !== undefined, {
    message: "At least one board preference is required.",
  });

export const CreateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: ProjectIconSchema.default("folder"),
    defaultSharingPolicy: BoardSharingPolicySchema.default("project"),
  })
  .strict();

export const UpdateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    icon: ProjectIconSchema.optional(),
    defaultSharingPolicy: BoardSharingPolicySchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one project field is required.",
  });

export const UpdateProjectPreferenceSchema = z.object({ pinned: z.boolean() }).strict();

export const AddProjectMemberSchema = z
  .object({
    email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
    role: BoardAccessRoleSchema,
  })
  .strict();

export const UpdateProjectMemberSchema = z.object({ role: BoardAccessRoleSchema }).strict();

export const AddBoardMemberSchema = AddProjectMemberSchema;
export const UpdateBoardMemberSchema = UpdateProjectMemberSchema;

export const UpdateBoardDocumentSchema = z.object({
  expectedRevision: NonnegativeRevisionSchema,
  expectedDocumentGenerationId: UuidSchema,
  document: BoardDocumentSchema,
});

export const CreateBoardCheckpointSchema = z
  .object({
    name: z.string().trim().min(1).max(BOARD_CHECKPOINT_NAME_MAX_LENGTH),
  })
  .strict();

export const RestoreBoardCheckpointSchema = z.object({}).strict();

export const CommentAnchorSchema = z
  .object({
    nodeId: z.string().trim().min(1).max(256).optional(),
    x: z.number().finite().min(-10_000_000).max(10_000_000).optional(),
    y: z.number().finite().min(-10_000_000).max(10_000_000).optional(),
  })
  .strict();

const CommentBodySchema = z.string().trim().min(1).max(4_000);

export const CreateCommentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    anchor: CommentAnchorSchema.default({}),
    body: CommentBodySchema,
  }),
  z.object({
    kind: z.literal("reply"),
    threadId: UuidSchema,
    body: CommentBodySchema,
  }),
]);

export const ResolveCommentThreadSchema = z.object({
  resolved: z.boolean(),
});

export const CreateShareLinkSchema = z.object({
  permission: ShareLinkPermissionSchema.default("viewer"),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const AddWorkspaceMemberSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  role: WorkspaceRoleSchema,
});

export const UpdateWorkspaceMemberSchema = z.object({
  role: WorkspaceRoleSchema,
});

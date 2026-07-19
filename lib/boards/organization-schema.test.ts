import { readFile } from "node:fs/promises";
import path from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  boardMemberships,
  BOARD_STATUSES,
  BOARD_WORKFLOW_STATUSES,
  boards,
  projectMemberships,
  workspaces,
} from "@/db/schema/product";

function foreignKeyColumns(table: typeof boards | typeof boardMemberships | typeof projectMemberships) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => ({
    name: foreignKey.getName(),
    columns: foreignKey.reference().columns.map((column) => column.name),
    foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
  }));
}

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("organization tenant constraints", () => {
  it("binds each board to a project in the same workspace", () => {
    expect(foreignKeyColumns(boards)).toContainEqual({
      name: "boards_project_workspace_fk",
      columns: ["project_id", "workspace_id"],
      foreignColumns: ["id", "workspace_id"],
    });
    expect(foreignKeyColumns(boards)).toContainEqual({
      name: "boards_owner_workspace_membership_fk",
      columns: ["workspace_id", "owner_id"],
      foreignColumns: ["workspace_id", "user_id"],
    });
  });

  it("prevents board and project memberships from crossing workspace membership", () => {
    expect(foreignKeyColumns(boardMemberships)).toContainEqual({
      name: "board_memberships_workspace_user_fk",
      columns: ["workspace_id", "user_id"],
      foreignColumns: ["workspace_id", "user_id"],
    });
    expect(foreignKeyColumns(projectMemberships)).toContainEqual({
      name: "project_memberships_project_workspace_fk",
      columns: ["project_id", "workspace_id"],
      foreignColumns: ["id", "workspace_id"],
    });
    expect(foreignKeyColumns(projectMemberships)).toContainEqual({
      name: "project_memberships_workspace_user_fk",
      columns: ["workspace_id", "user_id"],
      foreignColumns: ["workspace_id", "user_id"],
    });
  });

  it("keeps archive state orthogonal to the stored workflow status", async () => {
    expect(BOARD_WORKFLOW_STATUSES).toEqual([
      "draft",
      "active",
      "review",
      "approved",
    ]);
    expect(BOARD_STATUSES).toEqual([
      ...BOARD_WORKFLOW_STATUSES,
      "archived",
    ]);
    expect(getTableConfig(boards).checks.map((constraint) => constraint.name)).toContain(
      "boards_status_check",
    );
    expect(getTableConfig(boards).checks.map((constraint) => constraint.name)).not.toContain(
      "boards_archive_status_check",
    );

    const migration = await readFile(
      path.join(process.cwd(), "db", "migrations", "0009_young_chimera.sql"),
      "utf8",
    );
    const backfill = migration.indexOf(
      `UPDATE "boards" SET "status" = 'active' WHERE "status" = 'archived'`,
    );
    const constraint = migration.indexOf(
      `CHECK ("boards"."status" in ('draft', 'active', 'review', 'approved'))`,
    );
    expect(backfill).toBeGreaterThanOrEqual(0);
    expect(constraint).toBeGreaterThan(backfill);
  });

  it("creates composite tenant keys before foreign keys reference them", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "db", "migrations", "0006_cloudy_thunderball.sql"),
      "utf8",
    );
    const projectKey = migration.indexOf(
      `CREATE UNIQUE INDEX "projects_id_workspace_unique"`,
    );
    const projectReference = migration.indexOf(
      `ADD CONSTRAINT "project_memberships_project_workspace_fk"`,
    );
    const boardKey = migration.indexOf(
      `CREATE UNIQUE INDEX "boards_id_workspace_unique"`,
    );
    const boardReference = migration.indexOf(
      `ADD CONSTRAINT "board_memberships_board_workspace_fk"`,
    );

    expect(projectKey).toBeGreaterThanOrEqual(0);
    expect(projectReference).toBeGreaterThan(projectKey);
    expect(boardKey).toBeGreaterThanOrEqual(0);
    expect(boardReference).toBeGreaterThan(boardKey);
  });

  it("adds nullable deletion timestamps without destructive migration steps", async () => {
    expect(workspaces.deletedAt.name).toBe("deleted_at");
    expect(workspaces.deletedAt.notNull).toBe(false);
    expect(boards.deletedAt.name).toBe("deleted_at");
    expect(boards.deletedAt.notNull).toBe(false);

    const migration = await readFile(
      path.join(process.cwd(), "db", "migrations", "0014_nappy_photon.sql"),
      "utf8",
    );
    expect(migration).toContain(
      'ALTER TABLE "boards" ADD COLUMN "deleted_at" timestamp with time zone',
    );
    expect(migration).toContain(
      'ALTER TABLE "workspaces" ADD COLUMN "deleted_at" timestamp with time zone',
    );
    expect(migration).not.toMatch(/\bnot\s+null\b/i);
    expect(migration).not.toMatch(/\b(drop|truncate|delete|update)\b/i);
  });

  it("excludes soft-deleted workspaces and boards from organization lists", async () => {
    const repository = await readFile(
      path.join(process.cwd(), "lib", "boards", "repository.ts"),
      "utf8",
    );
    const workspaceListSource = sourceBetween(
      repository,
      "export async function listWorkspaces",
      "export async function deleteWorkspace",
    );
    const boardListSource = sourceBetween(
      repository,
      "export async function listBoardsPage",
      "export async function listBoards(",
    );

    expect(workspaceListSource).toContain("isNull(workspaces.deletedAt)");
    expect(boardListSource).toContain("isNull(boards.deletedAt)");
  });

  it("locks workspace deletion state before creating or deleting boards", async () => {
    const repository = await readFile(
      path.join(process.cwd(), "lib", "boards", "repository.ts"),
      "utf8",
    );
    const createBoardSource = sourceBetween(
      repository,
      "export async function createBoard",
      "export type BoardListInput",
    );
    const deleteBoardSource = sourceBetween(
      repository,
      "export async function deleteBoard",
      "export async function restoreBoard",
    );

    const createWorkspaceGuard = createBoardSource.indexOf(
      "isNull(workspaces.deletedAt)",
    );
    const createWorkspaceLock = createBoardSource.indexOf('.for("share")');
    const boardInsert = createBoardSource.indexOf(".insert(boards)");
    expect(createWorkspaceGuard).toBeGreaterThanOrEqual(0);
    expect(createWorkspaceLock).toBeGreaterThan(createWorkspaceGuard);
    expect(boardInsert).toBeGreaterThan(createWorkspaceLock);

    const workspaceDeletedAtSelection = deleteBoardSource.indexOf(
      "workspaceDeletedAt: workspaces.deletedAt",
    );
    const workspaceLock = deleteBoardSource.indexOf(
      '.for("share")',
      workspaceDeletedAtSelection,
    );
    const boardLock = deleteBoardSource.indexOf('.for("update")', workspaceLock);
    expect(workspaceDeletedAtSelection).toBeGreaterThanOrEqual(0);
    expect(deleteBoardSource).toContain(
      "if (!membership || membership.workspaceDeletedAt)",
    );
    expect(workspaceLock).toBeGreaterThan(workspaceDeletedAtSelection);
    expect(boardLock).toBeGreaterThan(workspaceLock);
  });

  it("keeps every board mutation guarded against soft-deleted boards", async () => {
    const repository = await readFile(
      path.join(process.cwd(), "lib", "boards", "repository.ts"),
      "utf8",
    );
    const guardedMutations = [
      sourceBetween(
        repository,
        "export async function updateBoardMetadata",
        "export async function archiveBoard",
      ),
      sourceBetween(
        repository,
        "export async function archiveBoard",
        "export async function deleteBoard",
      ),
      sourceBetween(
        repository,
        "export async function restoreBoard",
        "export async function updateBoardPreference",
      ),
      sourceBetween(
        repository,
        "export async function updateBoardDocument",
        "export async function listCommentThreads",
      ),
    ];

    for (const mutationSource of guardedMutations) {
      expect(mutationSource).toContain("isNull(boards.deletedAt)");
    }
  });

  it("does not mint realtime tickets for soft-deleted boards", async () => {
    const ticketRoute = await readFile(
      path.join(process.cwd(), "app", "api", "realtime", "ticket", "route.ts"),
      "utf8",
    );
    const ticketBoardQuery = sourceBetween(
      ticketRoute,
      "const [board] = await db",
      "if (!board)",
    );

    expect(ticketBoardQuery).toContain("isNull(boards.deletedAt)");
  });
});

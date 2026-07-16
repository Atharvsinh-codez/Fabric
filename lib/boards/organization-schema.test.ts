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
} from "@/db/schema/product";

function foreignKeyColumns(table: typeof boards | typeof boardMemberships | typeof projectMemberships) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => ({
    name: foreignKey.getName(),
    columns: foreignKey.reference().columns.map((column) => column.name),
    foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
  }));
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
});

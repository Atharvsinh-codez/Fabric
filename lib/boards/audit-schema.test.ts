import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { workspaceAuditEvents } from "@/db/schema/product";

describe("workspace audit event schema", () => {
  const config = getTableConfig(workspaceAuditEvents);

  it("anchors every event to one durable workspace and actor", () => {
    const foreignKeys = config.foreignKeys.map((foreignKey) => ({
      columns: foreignKey.reference().columns.map((column) => column.name),
      foreignColumns: foreignKey.reference().foreignColumns.map((column) => column.name),
    }));
    expect(foreignKeys).toContainEqual({ columns: ["workspace_id"], foreignColumns: ["id"] });
    expect(foreignKeys).toContainEqual({ columns: ["actor_id"], foreignColumns: ["id"] });
    expect(foreignKeys.some((foreignKey) => foreignKey.columns.includes("target_id"))).toBe(false);
  });

  it("indexes tenant timelines and tenant-scoped resource timelines", () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
    }));
    expect(indexes).toContainEqual({
      name: "workspace_audit_events_workspace_created_idx",
      columns: ["workspace_id", "created_at", "id"],
    });
    expect(indexes).toContainEqual({
      name: "workspace_audit_events_target_created_idx",
      columns: ["workspace_id", "target_type", "target_id", "created_at"],
    });
  });

  it("enforces event, target, role, and transition shapes in PostgreSQL", () => {
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "workspace_audit_events_event_type_check",
        "workspace_audit_events_target_type_check",
        "workspace_audit_events_role_check",
        "workspace_audit_events_transition_check",
      ]),
    );
  });
});

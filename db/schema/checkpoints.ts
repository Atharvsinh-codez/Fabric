import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { boards, type BoardDocument } from "./product";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const BOARD_CHECKPOINT_NAME_MAX_LENGTH = 80;

/**
 * Immutable, server-captured board snapshots. A restore copies the document
 * into the board; it never mutates the checkpoint that was selected.
 */
export const boardCheckpoints = pgTable(
  "board_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    document: jsonb("document").$type<BoardDocument>().notNull(),
    sourceDocumentGenerationId: uuid("source_document_generation_id").notNull(),
    sourceRevision: bigint("source_revision", { mode: "number" }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("board_checkpoints_board_created_idx").on(table.boardId, table.createdAt),
    index("board_checkpoints_board_name_idx").on(table.boardId, table.name),
    index("board_checkpoints_creator_created_idx").on(table.createdBy, table.createdAt),
    check(
      "board_checkpoints_name_length_check",
      sql`char_length(${table.name}) between 1 and 80`,
    ),
    check(
      "board_checkpoints_document_object_check",
      sql`jsonb_typeof(${table.document}) = 'object'`,
    ),
    check(
      "board_checkpoints_source_revision_check",
      sql`${table.sourceRevision} >= 0`,
    ),
  ],
);

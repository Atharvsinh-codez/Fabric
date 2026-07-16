import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("board checkpoint migration invariants", () => {
  it("stores immutable source metadata and emits executable DDL checks", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "db", "migrations", "0004_sharp_nicolaos.sql"),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "board_checkpoints"');
    expect(migration).toContain('"document" jsonb NOT NULL');
    expect(migration).toContain('"source_document_generation_id" uuid NOT NULL');
    expect(migration).toContain('"source_revision" bigint NOT NULL');
    expect(migration).toContain(
      'CHECK (char_length("board_checkpoints"."name") between 1 and 80)',
    );
    expect(migration).toContain('ON DELETE cascade');
    expect(migration).toContain('ON DELETE restrict');
    expect(migration).not.toMatch(/\$\d+/);
  });
});

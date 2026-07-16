import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("realtime migration invariants", () => {
  it("uses a unique HMAC redemption key and a scoped message idempotency key", async () => {
    const migration = await readFile(
      path.join(process.cwd(), "db", "migrations", "0002_realtime_collaboration.sql"),
      "utf8",
    );
    expect(migration).toContain('"ticket_hmac" text PRIMARY KEY NOT NULL');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "realtime_updates_message_id_unique" ON "realtime_updates" USING btree ("board_id","document_generation_id","message_id")',
    );
    expect(migration).toContain('"payload" bytea NOT NULL');
  });
});

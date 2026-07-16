import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "db/migrations/0008_narrow_shadow_king.sql"),
  "utf8",
);

describe("realtime revocation outbox migration", () => {
  it("is additive and enforces scoped, leased, retryable event shapes", () => {
    expect(migration).toContain('CREATE TABLE "realtime_revocation_outbox"');
    expect(migration).toContain("realtime_revocation_outbox_route_check");
    expect(migration).toContain("realtime_revocation_outbox_event_scope_check");
    expect(migration).toContain("realtime_revocation_outbox_lease_check");
    expect(migration).toContain("realtime_revocation_outbox_dispatch_idx");
    expect(migration).not.toMatch(/\b(drop|truncate)\s+(table|column)\b/i);
  });
});

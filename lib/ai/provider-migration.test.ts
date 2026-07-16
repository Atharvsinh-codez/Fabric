import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("OpenAI-compatible run provenance migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "db/migrations/0013_foamy_lionheart.sql"),
    "utf8",
  );
  const schema = readFileSync(join(process.cwd(), "db/schema/ai.ts"), "utf8");

  it("removes misleading defaults while preserving historical provider rows", () => {
    expect(migration).toContain('ALTER COLUMN "provider" DROP DEFAULT');
    expect(migration).toContain('ALTER COLUMN "model" DROP DEFAULT');
    expect(migration).toContain("'google-gemini', 'openai-compatible'");
    expect(migration).toContain("'gemini-3.5-flash', 'gemini-2.5-flash'");
    expect(migration).toContain("char_length(\"ai_runs\".\"model\") between 1 and 255");
  });

  it("keeps the declared Drizzle schema aligned with the additive constraint", () => {
    expect(schema).toContain("provider: text(\"provider\").notNull()");
    expect(schema).toContain("model: text(\"model\").notNull()");
    expect(schema).toContain("'google-gemini', 'openai-compatible'");
    expect(schema).toContain("char_length(${table.model}) between 1 and 255");
  });
});

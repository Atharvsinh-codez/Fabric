import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("AI proposal route duration", () => {
  it("keeps the Vercel function envelope at 300 seconds", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "app/api/ai/proposal/route.ts"),
      "utf8",
    );

    expect(routeSource).toMatch(/export const maxDuration = 300;/u);
  });
});

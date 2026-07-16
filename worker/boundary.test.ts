import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("web-to-worker credential boundary", () => {
  it("keeps the Google SDK and model credential out of the web proposal route", () => {
    const route = readFileSync(join(process.cwd(), "app/api/ai/proposal/route.ts"), "utf8");
    expect(route).not.toContain("@google/genai");
    expect(route).not.toContain("GEMINI_API_KEY");
    expect(route).not.toContain("GeminiInteractionsProvider");
    expect(route).toContain("createOrReuseAiRun");
    expect(route).toContain("listOwnedAiRunEvents");
    expect(route).toContain("dispatchAiRunOnDemand");
    expect(route).toContain("await dispatchPromise");
  });

  it("keeps the provider SDK import inside the narrow adapter", () => {
    const provider = readFileSync(join(process.cwd(), "lib/ai/providers/gemini.ts"), "utf8");
    expect(provider).toContain('from "@google/genai"');
    const processor = readFileSync(join(process.cwd(), "worker/processor.ts"), "utf8");
    expect(processor).not.toContain("@google/genai");
  });

  it("binds AI proposal durability to the saved Neon board revision", () => {
    const runRepository = readFileSync(
      join(process.cwd(), "lib/ai/server/run-repository.ts"),
      "utf8",
    );
    const approvalRepository = readFileSync(
      join(process.cwd(), "lib/ai/server/approval-repository.ts"),
      "utf8",
    );
    const workerRepository = readFileSync(
      join(process.cwd(), "worker/repository.ts"),
      "utf8",
    );
    for (const source of [runRepository, approvalRepository, workerRepository]) {
      expect(source).not.toContain("realtime_document_heads");
      expect(source).not.toContain("realtimeDocumentHeads");
    }
  });

  it("persists model and routing provenance without relying on a database default", () => {
    const runRepository = readFileSync(
      join(process.cwd(), "lib/ai/server/run-repository.ts"),
      "utf8",
    );

    expect(runRepository).toContain('const CONFIG_VERSION = "fabric-ai-config.v2"');
    expect(runRepository.match(/model: APPROVED_GEMINI_MODEL/g)).toHaveLength(2);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("web-to-worker credential boundary", () => {
  it("keeps provider credentials and the adapter out of the web proposal route", () => {
    const route = readFileSync(join(process.cwd(), "app/api/ai/proposal/route.ts"), "utf8");
    expect(route).not.toContain("AI_API_KEY");
    expect(route).not.toContain("OpenAiCompatibleChatProvider");
    expect(route).toContain("createOrReuseAiRun");
    expect(route).toContain("listOwnedAiRunEvents");
    expect(route).toContain("dispatchAiRunOnDemand");
    expect(route).toContain("await dispatchPromise");
  });

  it("keeps native streaming fetch inside the narrow provider adapter", () => {
    const providerPath = join(process.cwd(), "lib/ai/providers/openai-compatible.ts");
    const provider = readFileSync(providerPath, "utf8");
    expect(provider).toContain("OpenAiCompatibleChatProvider");
    expect(provider).toContain("stream: true");
    expect(provider).toContain('Accept: "text/event-stream"');
    const processor = readFileSync(join(process.cwd(), "worker/processor.ts"), "utf8");
    expect(processor).not.toContain("AI_API_KEY");
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

  it("persists environment-selected provider and model provenance explicitly", () => {
    const runRepository = readFileSync(
      join(process.cwd(), "lib/ai/server/run-repository.ts"),
      "utf8",
    );

    expect(runRepository).toContain('const CONFIG_VERSION = "fabric-ai-config.v3"');
    expect(runRepository.match(/provider: provenance\.provider/g)).toHaveLength(3);
    expect(runRepository.match(/model: provenance\.model/g)).toHaveLength(3);
  });
});

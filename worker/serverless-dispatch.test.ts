import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimAiJobByRunId: vi.fn(),
  createWorkerDatabase: vi.fn(),
  end: vi.fn(),
  loadServerlessWorkerConfig: vi.fn(),
  processClaimedAiJob: vi.fn(),
}));

vi.mock("../lib/ai/providers/openai-compatible", () => ({
  OpenAiCompatibleChatProvider: class OpenAiCompatibleChatProvider {},
}));
vi.mock("./config", () => ({
  loadServerlessWorkerConfig: mocks.loadServerlessWorkerConfig,
}));
vi.mock("./database", () => ({ createWorkerDatabase: mocks.createWorkerDatabase }));
vi.mock("./processor", () => ({ processClaimedAiJob: mocks.processClaimedAiJob }));
vi.mock("./repository", () => ({ claimAiJobByRunId: mocks.claimAiJobByRunId }));

import { dispatchAiRunOnDemand } from "./serverless-dispatch";

const job = {
  jobId: "11111111-1111-4111-8111-111111111111",
  providerKeyOrdinal: 1,
  runId: "22222222-2222-4222-8222-222222222222",
  provider: "openai-compatible",
  model: "gcli/grok-4.5-medium",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadServerlessWorkerConfig.mockReturnValue({
    databaseUrl: "postgresql://worker.example/fabric",
    runsEnabled: true,
    leaseMs: 60_000,
    workerId: "serverless-worker",
    ai: {
      provider: "openai-compatible",
      baseUrl: "https://provider.example.test/v1",
      apiKeys: ["test-key-with-enough-entropy"],
      model: "gcli/grok-4.5-medium",
      streamOnly: true,
      requestTimeoutMs: 45_000,
    },
  });
  mocks.createWorkerDatabase.mockReturnValue({ end: mocks.end });
  mocks.claimAiJobByRunId.mockResolvedValue(job);
  mocks.processClaimedAiJob.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});

describe("on-demand AI dispatch", () => {
  it("does nothing when the external worker runtime is responsible", async () => {
    await dispatchAiRunOnDemand(job.runId, { VERCEL: "0" });
    expect(mocks.loadServerlessWorkerConfig).not.toHaveBeenCalled();
  });

  it("claims and drains exactly the triggering run on Vercel", async () => {
    const environment = {
      VERCEL: "1",
      AI_RUNS_ENABLED: "true",
    };
    await dispatchAiRunOnDemand(job.runId, environment);

    expect(mocks.loadServerlessWorkerConfig).toHaveBeenCalledWith(environment);
    expect(mocks.claimAiJobByRunId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId: job.runId }),
    );
    expect(mocks.processClaimedAiJob).toHaveBeenCalledWith(
      expect.objectContaining({ job }),
    );
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it("closes its one-connection pool when startup fails", async () => {
    mocks.claimAiJobByRunId.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      dispatchAiRunOnDemand("77777777-7777-4777-8777-777777777777", {
        VERCEL: "1",
        AI_RUNS_ENABLED: "true",
      }),
    ).rejects.toThrow("database unavailable");
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});

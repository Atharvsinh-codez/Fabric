import { describe, expect, it, vi } from "vitest";

import type { WorkerSql } from "./database";
import {
  claimAiJobByRunId,
  claimNextAiJob,
  recordClarificationReady,
} from "./repository";

const runId = "22222222-2222-4222-8222-222222222222";

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    providerKeyOrdinal: "42",
    runId,
    leaseOwner: "serverless-worker",
    attempt: "1",
    maxAttempts: "1",
    runStatus: "queued" as const,
    skillVersion: "2.0.0",
    promptVersion: "canvas-agent.plan.v5",
    provider: "openai-compatible",
    model: "gcli/grok-4.5-medium",
    principalId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    boardId: "55555555-5555-4555-8555-555555555555",
    documentGenerationId: "66666666-6666-4666-8666-666666666666",
    baseDurableSequence: "9",
    selectionHash: "a".repeat(64),
    executionInput: {
      skill: "canvas-agent" as const,
      workspaceId: "44444444-4444-4444-8444-444444444444",
      boardId: "55555555-5555-4555-8555-555555555555",
      documentGenerationId: "66666666-6666-4666-8666-666666666666",
      durableSequence: 9,
      instruction: "Organize these notes.",
      selection: [],
      viewport: { x: 0, y: 0, width: 1280, height: 720 },
      conversation: [],
    },
    deadlineAt: new Date(Date.now() + 30_000),
    ...overrides,
  };
}

describe("serverless AI job claiming", () => {
  it("claims only the requested run and normalizes bigint counters", async () => {
    const query = vi.fn().mockResolvedValue([claimedRow()]);

    const claimed = await claimAiJobByRunId(query as unknown as WorkerSql, {
      runId,
      workerId: "serverless-worker",
      leaseMs: 60_000,
    });

    expect(claimed).toMatchObject({
      runId,
      providerKeyOrdinal: 42,
      attempt: 1,
      maxAttempts: 1,
      baseDurableSequence: 9,
      provider: "openai-compatible",
      model: "gcli/grok-4.5-medium",
    });
    const [strings, ...values] = query.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const statement = strings.join("?");
    expect(statement).toContain("j.run_id = ?");
    expect(statement).toContain(
      `nextval('ai_provider_key_ordinal_seq') as "providerKeyOrdinal"`,
    );
    expect(statement).toContain("r.model as model");
    expect(statement).toContain("r.provider as provider");
    expect(statement).toContain('r.skill_version as "skillVersion"');
    expect(statement).toContain('r.prompt_version as "promptVersion"');
    expect(statement.match(/nextval/gu)).toHaveLength(1);
    expect(values).toContain(runId);
    expect(query).toHaveBeenCalledOnce();
  });

  it("allocates a durable ordinal and returns the model from the queue claim path", async () => {
    const query = vi.fn().mockResolvedValue([claimedRow({
      providerKeyOrdinal: BigInt(Number.MAX_SAFE_INTEGER),
      leaseOwner: "attached-worker",
    })]);

    await expect(claimNextAiJob(query as unknown as WorkerSql, {
      workerId: "attached-worker",
      leaseMs: 60_000,
    })).resolves.toMatchObject({
      providerKeyOrdinal: Number.MAX_SAFE_INTEGER,
      provider: "openai-compatible",
      model: "gcli/grok-4.5-medium",
    });

    const [strings] = query.mock.calls[0] as [TemplateStringsArray];
    const statement = strings.join("?");
    expect(statement).toContain(
      `nextval('ai_provider_key_ordinal_seq') as "providerKeyOrdinal"`,
    );
    expect(statement).toContain("r.model as model");
    expect(statement).toContain("r.provider as provider");
    expect(statement.match(/nextval/gu)).toHaveLength(1);
    expect(query).toHaveBeenCalledOnce();
  });

  it("fails closed when a claimed ordinal cannot be represented safely", async () => {
    const query = vi.fn().mockResolvedValue([
      claimedRow({ providerKeyOrdinal: "9007199254740992" }),
    ]);

    await expect(claimAiJobByRunId(query as unknown as WorkerSql, {
      runId,
      workerId: "serverless-worker",
      leaseMs: 60_000,
    })).rejects.toThrow(/ordinal.*safe range/i);
  });

  it("completes a clarification with one safe result event and one terminal event", async () => {
    const statements: Array<{ text: string; values: unknown[] }> = [];
    const transaction = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("?").replace(/\s+/gu, " ").trim();
        statements.push({ text, values });
        if (text.includes("from ai_runs") && text.includes("for update")) {
          return [{
            status: "validating_proposal",
            lastEventSequence: "5",
            cancelRequestedAt: null,
          }];
        }
        return [];
      }),
      { json: (value: unknown) => value },
    );
    const sql = Object.assign(vi.fn(), {
      json: (value: unknown) => value,
      begin: async <Result>(callback: (client: typeof transaction) => Promise<Result>) =>
        callback(transaction),
    });
    const row = claimedRow();
    const claimed = {
      ...row,
      providerKeyOrdinal: 1,
      attempt: 1,
      maxAttempts: 1,
      baseDurableSequence: 9,
    };

    await expect(recordClarificationReady(sql as unknown as WorkerSql, {
      job: claimed,
      clarification: {
        kind: "clarification",
        reason: "missing-selection",
        question: "Which cards should I organize?",
        choices: ["Use my selection"],
      },
      responseHash: "b".repeat(64),
      usage: { totalTokens: 12 },
    })).resolves.toBe(true);

    expect(statements.some((statement) =>
      statement.text.includes("update ai_runs") && statement.text.includes("status = 'completed'"),
    )).toBe(true);
    const insertedEventTypes = statements
      .filter((statement) => statement.text.includes("insert into ai_run_events"))
      .flatMap((statement) => statement.values)
      .filter((value) => typeof value === "string");
    expect(insertedEventTypes).toEqual(expect.arrayContaining([
      "clarification.ready",
      "run.completed",
    ]));
  });
});

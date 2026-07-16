import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  finalizeAiProposalApproval: vi.fn(),
}));

vi.mock("@/lib/auth/require-principal", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));
vi.mock("@/lib/ai/server/approval-repository", () => ({
  finalizeAiProposalApproval: mocks.finalizeAiProposalApproval,
}));

import { POST } from "@/app/api/ai/proposal/approval/route";

const approval = {
  runId: "22222222-2222-4222-8222-222222222222",
  patchHash: "a".repeat(64),
  documentGenerationId: "66666666-6666-4666-8666-666666666666",
  baseDurableSequence: 7,
  observedDurableSequence: 8,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePrincipal.mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
  });
  mocks.finalizeAiProposalApproval.mockResolvedValue({
    run: {
      id: approval.runId,
      status: "completed",
      boardId: "55555555-5555-4555-8555-555555555555",
      documentGenerationId: approval.documentGenerationId,
      baseDurableSequence: 7,
      appliedDurableSequence: 8,
      finalizedAt: "2026-07-13T12:00:00.000Z",
    },
  });
});

function request(body: unknown, origin = "https://fabric.test") {
  return new Request("https://fabric.test/api/ai/proposal/approval", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

describe("AI proposal approval route", () => {
  it("finalizes only the authenticated principal's strict approval binding", async () => {
    const response = await POST(request(approval));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.finalizeAiProposalApproval).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      approval,
    );
  });

  it("rejects cross-origin and malformed approvals before repository access", async () => {
    expect((await POST(request(approval, "https://attacker.test"))).status).toBe(403);
    expect((await POST(request({ ...approval, patchHash: "wrong" }))).status).toBe(422);
    expect(mocks.finalizeAiProposalApproval).not.toHaveBeenCalled();
  });
});

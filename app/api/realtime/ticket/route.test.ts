import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  resolveBoardAccess: vi.fn(),
  select: vi.fn(),
  getRealtimeIssuerEnvironment: vi.fn(),
  mintRealtimeTicket: vi.fn(),
}));

vi.mock("@/lib/auth/require-principal", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));
vi.mock("@/lib/boards/access", () => ({
  resolveBoardAccess: mocks.resolveBoardAccess,
}));
vi.mock("@/db/clients/web", () => ({
  db: { select: mocks.select },
}));
vi.mock("@/lib/realtime/env", () => ({
  getRealtimeIssuerEnvironment: mocks.getRealtimeIssuerEnvironment,
}));
vi.mock("@/lib/realtime/tickets", () => ({
  mintRealtimeTicket: mocks.mintRealtimeTicket,
}));

import { POST } from "./route";

const ORIGIN = "https://fabric.athrix.me";
const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";
const WORKSPACE_ID = "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f";
const BOARD_ID = "0bcb645c-3e28-459e-8369-a03582185d87";
const DOCUMENT_GENERATION_ID = "740afc4d-43d8-4876-bc21-5189ad4c28ef";

function ticketRequest(): Request {
  return new Request(`${ORIGIN}/api/realtime/ticket`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ boardId: BOARD_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePrincipal.mockResolvedValue({ id: USER_ID, name: "Workspace member" });
  mocks.getRealtimeIssuerEnvironment.mockReturnValue({
    signingKey: "s".repeat(32),
    issuer: "fabric-web",
    audience: "fabric-realtime",
    allowedOrigins: new Set([ORIGIN]),
  });
  mocks.select.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([
          {
            id: BOARD_ID,
            workspaceId: WORKSPACE_ID,
            documentGenerationId: DOCUMENT_GENERATION_ID,
          },
        ]),
      })),
    })),
  });
});

describe("realtime ticket route workspace access", () => {
  it.each([
    { role: "editor" as const, capabilities: ["read", "write", "awareness"] },
    { role: "viewer" as const, capabilities: ["read", "awareness"] },
  ])(
    "issues the correct ticket to a non-owner workspace $role",
    async ({ role, capabilities }) => {
      mocks.resolveBoardAccess.mockResolvedValue({
        role,
        source: "workspace",
        workspaceId: WORKSPACE_ID,
        archivedAt: null,
      });
      mocks.mintRealtimeTicket.mockImplementation(async (input) => ({
        ticket: "t".repeat(64),
        claims: {
          protocolVersion: 1,
          exp: 2_000_000_000,
          boardId: input.boardId,
          documentGenerationId: input.documentGenerationId,
          capabilities: input.capabilities,
        },
      }));

      const response = await POST(ticketRequest());

      expect(response.status).toBe(200);
      expect(mocks.resolveBoardAccess).toHaveBeenCalledWith(USER_ID, BOARD_ID);
      expect(mocks.mintRealtimeTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: USER_ID,
          workspaceId: WORKSPACE_ID,
          boardId: BOARD_ID,
          documentGenerationId: DOCUMENT_GENERATION_ID,
          capabilities,
        }),
        expect.objectContaining({
          issuer: "fabric-web",
          audience: "fabric-realtime",
        }),
      );
      expect(await response.json()).toMatchObject({
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        capabilities,
      });
    },
  );
});

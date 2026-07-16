import { beforeEach, describe, expect, it, vi } from "vitest";

const { postgresFactory } = vi.hoisted(() => ({
  postgresFactory: vi.fn(() => ({ end: vi.fn() })),
}));

vi.mock("postgres", () => ({ default: postgresFactory }));

import {
  REALTIME_POSTGRES_TIMEOUTS,
  RealtimePostgresPersistence,
} from "./postgres";

const principalId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const boardId = "33333333-3333-4333-8333-333333333333";
const generationId = "44444444-4444-4444-8444-444444444444";

type TestAccessSnapshot = {
  archived_at: Date | null;
  direct_role: "editor" | "commenter" | "viewer" | null;
  owner_id: string;
  project_role: "editor" | "commenter" | "viewer" | null;
  sharing_policy: "private" | "project" | "workspace";
  workspace_id: string;
  workspace_role: "owner" | "editor" | "commenter" | "viewer" | null;
};

const accessSnapshot: TestAccessSnapshot = {
  archived_at: null,
  direct_role: null,
  owner_id: "55555555-5555-4555-8555-555555555555",
  project_role: null,
  sharing_policy: "workspace",
  workspace_id: workspaceId,
  workspace_role: "editor",
};

describe("RealtimePostgresPersistence connection policy", () => {
  beforeEach(() => {
    postgresFactory.mockClear();
  });

  it("bounds connection, statement, lock, and idle transaction waits", () => {
    const databaseUrl = "postgresql://fabric.invalid/fabric";

    new RealtimePostgresPersistence(databaseUrl);

    expect(postgresFactory).toHaveBeenCalledWith(
      databaseUrl,
      expect.objectContaining({
        connect_timeout: REALTIME_POSTGRES_TIMEOUTS.connectSeconds,
        connection: {
          application_name: "fabric-realtime",
          statement_timeout: REALTIME_POSTGRES_TIMEOUTS.statementMs,
          lock_timeout: REALTIME_POSTGRES_TIMEOUTS.lockMs,
          idle_in_transaction_session_timeout:
            REALTIME_POSTGRES_TIMEOUTS.idleInTransactionMs,
        },
      }),
    );
    expect(REALTIME_POSTGRES_TIMEOUTS.statementMs).toBeLessThanOrEqual(10_000);
    expect(REALTIME_POSTGRES_TIMEOUTS.lockMs).toBeLessThan(
      REALTIME_POSTGRES_TIMEOUTS.statementMs,
    );
  });
});

describe("RealtimePostgresPersistence access query", () => {
  it("rechecks exact tenant, board, generation, archive, and membership scope", async () => {
    const queries: Array<{ text: string; parameters: unknown[] }> = [];
    let snapshot = accessSnapshot;
    const transaction = vi.fn(
      (strings: TemplateStringsArray, ...parameters: unknown[]) => {
        queries.push({ text: strings.join("?"), parameters });
        return Promise.resolve([snapshot]);
      },
    );
    const database = {
      begin: vi.fn(
        (callback: (sql: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
      end: vi.fn(),
    };
    postgresFactory.mockReturnValueOnce(database);

    const persistence = new RealtimePostgresPersistence(
      "postgresql://fabric.invalid/fabric",
    );
    const allowed = await persistence.recheckAccess({
      sub: principalId,
      workspaceId,
      boardId,
      documentGenerationId: generationId,
      capabilities: ["read", "write", "awareness"],
      protocolVersion: 1,
      jti: "66666666-6666-4666-8666-666666666666",
      iat: 1_700_000_000,
      exp: 1_700_000_045,
      iss: "fabric-web-test",
      aud: "fabric-realtime-test",
      role: "editor",
    });

    expect(allowed).toBe(true);
    expect(queries[0]?.parameters).toEqual([
      boardId,
      workspaceId,
      generationId,
      principalId,
      principalId,
      principalId,
    ]);
    expect(queries[0]?.text).toContain("board.archived_at is null");
    expect(queries[0]?.text).toContain("from board_memberships as membership");
    expect(queries[0]?.text).toContain("from project_memberships as membership");
    expect(queries[0]?.text.match(/for share of membership/g)).toHaveLength(3);

    snapshot = {
      ...accessSnapshot,
      direct_role: "commenter",
      sharing_policy: "private",
    };
    await expect(
      persistence.recheckAccess({
        sub: principalId,
        workspaceId,
        boardId,
        documentGenerationId: generationId,
        capabilities: ["read", "write", "awareness"],
        protocolVersion: 1,
        jti: "77777777-7777-4777-8777-777777777777",
        iat: 1_700_000_000,
        exp: 1_700_000_045,
        iss: "fabric-web-test",
        aud: "fabric-realtime-test",
        role: "editor",
      }),
    ).resolves.toBe(false);
    expect(queries).toHaveLength(2);
  });
});

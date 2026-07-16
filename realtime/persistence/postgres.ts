import postgres from "postgres";

import type {
  BoardAccessRole,
  BoardSharingPolicy,
} from "../../db/schema/product";
import { effectiveBoardAccess } from "../../lib/boards/access-policy";
import {
  capabilitiesAreAllowed,
  capabilitiesForRole,
  type RealtimeWorkspaceRole,
} from "../../lib/realtime/capabilities";
import type { RealtimeErrorCode } from "../../lib/realtime/constants";
import { hmacTicketIdentifier } from "../../lib/realtime/hashing";
import { classifyIdempotency } from "../../lib/realtime/idempotency";
import type { RealtimeTicketClaims } from "../../lib/realtime/tickets";

type AccessSnapshotRow = {
  archived_at: Date | null;
  direct_role: BoardAccessRole | null;
  owner_id: string;
  project_role: BoardAccessRole | null;
  sharing_policy: BoardSharingPolicy;
  workspace_id: string;
  workspace_role: RealtimeWorkspaceRole | null;
};
type ExistingUpdateRow = { payload_hash: string; sequence: string | number };
type HeadRow = { last_sequence: string | number };
type StoredUpdateRow = {
  sequence: string | number;
  payload: Uint8Array;
  payload_hash: string;
};

export type RealtimeAdmission = RealtimeTicketClaims & {
  role: RealtimeWorkspaceRole;
};

export type RedemptionResult =
  | { kind: "allowed"; admission: RealtimeAdmission }
  | { kind: "permission_denied" }
  | { kind: "replayed" };

export type PersistUpdateResult =
  | { kind: "committed"; sequence: number }
  | { kind: "duplicate"; sequence: number }
  | { kind: "conflict" }
  | { kind: "permission_denied" };

export type LoadedRealtimeRoom = {
  lastSequence: number;
  updates: Array<{ sequence: number; update: Uint8Array; payloadHash: string }>;
};

type RealtimeAccessScope = Readonly<{
  boardId: string;
  documentGenerationId: string;
  principalId: string;
  workspaceId: string;
}>;

function effectiveRealtimeRole(
  principalId: string,
  snapshot: AccessSnapshotRow,
): RealtimeWorkspaceRole | null {
  return (
    effectiveBoardAccess({
      userId: principalId,
      workspaceId: snapshot.workspace_id,
      ownerId: snapshot.owner_id,
      sharingPolicy: snapshot.sharing_policy,
      archivedAt: snapshot.archived_at,
      workspaceRole: snapshot.workspace_role,
      directRole: snapshot.direct_role,
      projectRole: snapshot.project_role,
    })?.role ?? null
  );
}

function safeSequence(value: string | number): number {
  const sequence = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error("Realtime persistence returned an unsafe sequence value.");
  }
  return sequence;
}

function toUint8Array(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

export const REALTIME_POSTGRES_TIMEOUTS = {
  connectSeconds: 8,
  statementMs: 8_000,
  lockMs: 3_000,
  idleInTransactionMs: 10_000,
} as const;

export class RealtimePostgresPersistence {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, {
      max: 10,
      prepare: false,
      connect_timeout: REALTIME_POSTGRES_TIMEOUTS.connectSeconds,
      idle_timeout: 30,
      max_lifetime: 60 * 30,
      connection: {
        application_name: "fabric-realtime",
        statement_timeout: REALTIME_POSTGRES_TIMEOUTS.statementMs,
        lock_timeout: REALTIME_POSTGRES_TIMEOUTS.lockMs,
        idle_in_transaction_session_timeout:
          REALTIME_POSTGRES_TIMEOUTS.idleInTransactionMs,
      },
    });
  }

  /**
   * Resolve the same first-applicable board grant as the HTTP application while
   * holding share locks on the scoped board and every matching membership row.
   * This prevents an update commit from racing a role change or revocation.
   */
  private async resolveEffectiveRole(
    transaction: postgres.TransactionSql,
    scope: RealtimeAccessScope,
  ): Promise<RealtimeWorkspaceRole | null> {
    const access = await transaction<AccessSnapshotRow[]>`
      with scoped_board as materialized (
        select
          board.id,
          board.workspace_id,
          board.project_id,
          board.owner_id,
          board.sharing_policy,
          board.archived_at
        from boards as board
        where board.id = ${scope.boardId}::uuid
          and board.workspace_id = ${scope.workspaceId}::uuid
          and board.document_generation_id = ${scope.documentGenerationId}::uuid
          and board.archived_at is null
        limit 1
        for share of board
      ),
      workspace_grant as materialized (
        select membership.role
        from workspace_memberships as membership
        inner join scoped_board as board
          on board.workspace_id = membership.workspace_id
        where membership.user_id = ${scope.principalId}::uuid
        for share of membership
      ),
      direct_grant as materialized (
        select membership.role
        from board_memberships as membership
        inner join scoped_board as board
          on board.workspace_id = membership.workspace_id
         and board.id = membership.board_id
        where membership.user_id = ${scope.principalId}::uuid
        for share of membership
      ),
      project_grant as materialized (
        select membership.role
        from project_memberships as membership
        inner join scoped_board as board
          on board.workspace_id = membership.workspace_id
         and board.project_id = membership.project_id
        where membership.user_id = ${scope.principalId}::uuid
        for share of membership
      )
      select
        board.workspace_id,
        board.owner_id,
        board.sharing_policy,
        board.archived_at,
        workspace_grant.role as workspace_role,
        direct_grant.role as direct_role,
        project_grant.role as project_role
      from scoped_board as board
      left join workspace_grant on true
      left join direct_grant on true
      left join project_grant on true
      limit 1
    `;
    const snapshot = access[0];
    return snapshot ? effectiveRealtimeRole(scope.principalId, snapshot) : null;
  }

  async redeemTicket(
    claims: RealtimeTicketClaims,
    redemptionKey: string,
  ): Promise<RedemptionResult> {
    const ticketHmac = hmacTicketIdentifier(claims.jti, redemptionKey);
    return this.sql.begin(async (transaction) => {
      const inserted = await transaction<{ ticket_hmac: string }[]>`
        insert into realtime_ticket_redemptions (
          ticket_hmac,
          principal_id,
          board_id,
          document_generation_id,
          expires_at
        ) values (
          ${ticketHmac},
          ${claims.sub}::uuid,
          ${claims.boardId}::uuid,
          ${claims.documentGenerationId}::uuid,
          ${new Date(claims.exp * 1000)}
        )
        on conflict (ticket_hmac) do nothing
        returning ticket_hmac
      `;

      if (inserted.length === 0) {
        await transaction`
          insert into realtime_security_events (code)
          values ('ticket_replayed')
        `;
        return { kind: "replayed" } as const;
      }

      const role = await this.resolveEffectiveRole(transaction, {
        principalId: claims.sub,
        boardId: claims.boardId,
        workspaceId: claims.workspaceId,
        documentGenerationId: claims.documentGenerationId,
      });
      if (
        !role ||
        !capabilitiesAreAllowed(claims.capabilities, capabilitiesForRole(role))
      ) {
        await transaction`
          insert into realtime_security_events (code)
          values ('permission_denied')
        `;
        return { kind: "permission_denied" } as const;
      }

      return { kind: "allowed", admission: { ...claims, role } } as const;
    });
  }

  async recheckAccess(admission: RealtimeAdmission): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const role = await this.resolveEffectiveRole(transaction, {
        principalId: admission.sub,
        boardId: admission.boardId,
        workspaceId: admission.workspaceId,
        documentGenerationId: admission.documentGenerationId,
      });
      return Boolean(
        role &&
          capabilitiesAreAllowed(admission.capabilities, capabilitiesForRole(role)),
      );
    });
  }

  async loadRoom(boardId: string, documentGenerationId: string): Promise<LoadedRealtimeRoom> {
    const [heads, storedUpdates] = await Promise.all([
      this.sql<HeadRow[]>`
        select last_sequence
        from realtime_document_heads
        where board_id = ${boardId}::uuid
          and document_generation_id = ${documentGenerationId}::uuid
        limit 1
      `,
      this.sql<StoredUpdateRow[]>`
        select sequence, payload, payload_hash
        from realtime_updates
        where board_id = ${boardId}::uuid
          and document_generation_id = ${documentGenerationId}::uuid
        order by sequence asc
      `,
    ]);

    const lastSequence = heads[0] ? safeSequence(heads[0].last_sequence) : 0;
    const updates = storedUpdates.map((row) => ({
      sequence: safeSequence(row.sequence),
      update: toUint8Array(row.payload),
      payloadHash: row.payload_hash,
    }));
    if (updates.length !== lastSequence) {
      throw new Error("Realtime update history is not contiguous.");
    }
    for (let index = 0; index < updates.length; index += 1) {
      if (updates[index]?.sequence !== index + 1) {
        throw new Error("Realtime update history contains a sequence gap.");
      }
    }
    return { lastSequence, updates };
  }

  async persistUpdate(input: {
    admission: RealtimeAdmission;
    messageId: string;
    clientInstanceId: string;
    update: Uint8Array;
    payloadHash: string;
  }): Promise<PersistUpdateResult> {
    return this.sql.begin(async (transaction) => {
      const role = await this.resolveEffectiveRole(transaction, {
        principalId: input.admission.sub,
        boardId: input.admission.boardId,
        workspaceId: input.admission.workspaceId,
        documentGenerationId: input.admission.documentGenerationId,
      });
      if (!role || !capabilitiesForRole(role).includes("write")) {
        return { kind: "permission_denied" } as const;
      }

      await transaction`
        insert into realtime_document_heads (board_id, document_generation_id)
        values (
          ${input.admission.boardId}::uuid,
          ${input.admission.documentGenerationId}::uuid
        )
        on conflict (board_id, document_generation_id) do nothing
      `;
      const heads = await transaction<HeadRow[]>`
        select last_sequence
        from realtime_document_heads
        where board_id = ${input.admission.boardId}::uuid
          and document_generation_id = ${input.admission.documentGenerationId}::uuid
        for update
      `;
      const head = heads[0];
      if (!head) throw new Error("Realtime document head could not be locked.");

      const existing = await transaction<ExistingUpdateRow[]>`
        select payload_hash, sequence
        from realtime_updates
        where board_id = ${input.admission.boardId}::uuid
          and document_generation_id = ${input.admission.documentGenerationId}::uuid
          and message_id = ${input.messageId}::uuid
        limit 1
      `;
      const idempotency = classifyIdempotency(existing[0]?.payload_hash, input.payloadHash);
      if (idempotency.kind === "replay") {
        return { kind: "duplicate", sequence: safeSequence(existing[0]!.sequence) } as const;
      }
      if (idempotency.kind === "conflict") {
        await transaction`
          insert into realtime_security_events (
            code,
            principal_id,
            board_id,
            document_generation_id,
            message_id,
            details
          ) values (
            'idempotency_conflict',
            ${input.admission.sub}::uuid,
            ${input.admission.boardId}::uuid,
            ${input.admission.documentGenerationId}::uuid,
            ${input.messageId}::uuid,
            ${transaction.json({ clientInstanceId: input.clientInstanceId })}
          )
        `;
        return { kind: "conflict" } as const;
      }

      const nextSequence = safeSequence(head.last_sequence) + 1;
      if (!Number.isSafeInteger(nextSequence)) {
        throw new Error("Realtime sequence capacity has been exceeded.");
      }
      await transaction`
        update realtime_document_heads
        set last_sequence = ${nextSequence}, updated_at = now()
        where board_id = ${input.admission.boardId}::uuid
          and document_generation_id = ${input.admission.documentGenerationId}::uuid
      `;
      await transaction`
        insert into realtime_updates (
          board_id,
          document_generation_id,
          sequence,
          message_id,
          client_instance_id,
          principal_id,
          payload,
          payload_hash
        ) values (
          ${input.admission.boardId}::uuid,
          ${input.admission.documentGenerationId}::uuid,
          ${nextSequence},
          ${input.messageId}::uuid,
          ${input.clientInstanceId}::uuid,
          ${input.admission.sub}::uuid,
          ${Buffer.from(input.update)},
          ${input.payloadHash}
        )
      `;
      return { kind: "committed", sequence: nextSequence } as const;
    });
  }

  async cleanupExpiredEphemeralRecords(): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`
        delete from realtime_ticket_redemptions
        where expires_at < now() - interval '5 minutes'
      `;
      await transaction`
        delete from realtime_ticket_mint_windows
        where window_started_at < now() - interval '5 minutes'
      `;
    });
  }

  async recordSecurityEvent(input: {
    code: RealtimeErrorCode;
    admission?: RealtimeAdmission;
    messageId?: string;
    details?: Record<string, string | number | boolean>;
  }): Promise<void> {
    await this.sql`
      insert into realtime_security_events (
        code,
        principal_id,
        board_id,
        document_generation_id,
        message_id,
        details
      ) values (
        ${input.code},
        ${input.admission?.sub ?? null}::uuid,
        ${input.admission?.boardId ?? null}::uuid,
        ${input.admission?.documentGenerationId ?? null}::uuid,
        ${input.messageId ?? null}::uuid,
        ${this.sql.json(input.details ?? {})}
      )
    `;
  }

  async ping(): Promise<void> {
    await this.sql`select 1`;
  }

  async assertSchemaReady(): Promise<void> {
    const rows = await this.sql<
      Array<{
        heads: string | null;
        mint_windows: string | null;
        redemptions: string | null;
        security_events: string | null;
        updates: string | null;
      }>
    >`
      select
        to_regclass('public.realtime_document_heads')::text as heads,
        to_regclass('public.realtime_ticket_mint_windows')::text as mint_windows,
        to_regclass('public.realtime_ticket_redemptions')::text as redemptions,
        to_regclass('public.realtime_security_events')::text as security_events,
        to_regclass('public.realtime_updates')::text as updates
    `;
    const schema = rows[0];
    if (
      !schema?.heads ||
      !schema.mint_windows ||
      !schema.redemptions ||
      !schema.security_events ||
      !schema.updates
    ) {
      throw new Error("The realtime database migration has not been applied.");
    }
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";

import { REALTIME_LIMITS } from "../constants";
import type {
  DocumentPersistence,
  DocumentPersistenceFactory,
  PendingUpdate,
  PendingUpdateAckResult,
  PendingUpdateOutbox,
  RealtimeRecoveryCheckpoint,
  RealtimeScope,
  RecoveryCheckpointAdvanceResult,
} from "./types";

const OUTBOX_STORE = "pending_crdt_updates";
const RECOVERY_CHECKPOINT_STORE = "committed_recovery_checkpoint";
const RECOVERY_CHECKPOINT_KEY = "committed";

function scopeKey(scope: RealtimeScope): string {
  return `${scope.principalId}:${scope.boardId}:${scope.documentGenerationId}`;
}

export function scopedStorageName(
  kind: "document" | "outbox",
  scope: RealtimeScope,
): string {
  return `fabric-realtime-v1:${kind}:${scopeKey(scope)}`;
}

function cloneUpdate(update: PendingUpdate): PendingUpdate {
  return { ...update, update: new Uint8Array(update.update) };
}

function updatesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

type StoredPendingUpdate = Omit<PendingUpdate, "update"> & {
  update: ArrayBuffer;
};
type StoredRecoveryCheckpoint = Omit<
  RealtimeRecoveryCheckpoint,
  "stateUpdate"
> & {
  id: typeof RECOVERY_CHECKPOINT_KEY;
  stateUpdate: ArrayBuffer;
};

function cloneRecoveryCheckpoint(
  checkpoint: RealtimeRecoveryCheckpoint,
): RealtimeRecoveryCheckpoint {
  return {
    ...checkpoint,
    stateUpdate: new Uint8Array(checkpoint.stateUpdate),
  };
}

function validateRecoveryCheckpoint(
  checkpoint: RealtimeRecoveryCheckpoint,
): void {
  if (
    !Number.isSafeInteger(checkpoint.committedSequence) ||
    checkpoint.committedSequence < 0 ||
    checkpoint.stateUpdate.byteLength === 0 ||
    checkpoint.stateUpdate.byteLength > REALTIME_LIMITS.snapshotBytes ||
    !/^[0-9a-f]{64}$/.test(checkpoint.payloadHash) ||
    !Number.isFinite(checkpoint.updatedAt) ||
    checkpoint.updatedAt <= 0
  ) {
    throw new TypeError("The realtime recovery checkpoint is invalid.");
  }
}

export class PendingUpdateConflictError extends Error {
  constructor() {
    super("An immutable realtime message ID was reused with different bytes.");
    this.name = "PendingUpdateConflictError";
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

export class IndexedDbPendingUpdateOutbox implements PendingUpdateOutbox {
  private readonly databases = new Map<string, Promise<IDBDatabase>>();

  private database(scope: RealtimeScope): Promise<IDBDatabase> {
    const name = scopedStorageName("outbox", scope);
    const existing = this.databases.get(name);
    if (existing) return existing;
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is unavailable."));
    }
    const opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OUTBOX_STORE)) {
          request.result.createObjectStore(OUTBOX_STORE, {
            keyPath: "messageId",
          });
        }
        if (
          !request.result.objectStoreNames.contains(RECOVERY_CHECKPOINT_STORE)
        ) {
          request.result.createObjectStore(RECOVERY_CHECKPOINT_STORE, {
            keyPath: "id",
          });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB could not be opened."));
      request.onblocked = () =>
        reject(new Error("IndexedDB is blocked by another page."));
    });
    this.databases.set(name, opened);
    void opened.catch(() => this.databases.delete(name));
    return opened;
  }

  async put(scope: RealtimeScope, update: PendingUpdate): Promise<void> {
    const database = await this.database(scope);
    const transaction = database.transaction(OUTBOX_STORE, "readwrite", {
      durability: "strict",
    });
    const store = transaction.objectStore(OUTBOX_STORE);
    const existing = (await requestResult(store.get(update.messageId))) as
      StoredPendingUpdate | undefined;
    if (existing) {
      const existingBytes = new Uint8Array(existing.update);
      if (
        existing.payloadHash !== update.payloadHash ||
        !updatesEqual(existingBytes, update.update)
      ) {
        transaction.abort();
        throw new PendingUpdateConflictError();
      }
    } else {
      store.add({
        ...update,
        update: new Uint8Array(update.update).buffer,
      } satisfies StoredPendingUpdate);
    }
    await transactionComplete(transaction);
  }

  async list(scope: RealtimeScope): Promise<PendingUpdate[]> {
    const database = await this.database(scope);
    const transaction = database.transaction(OUTBOX_STORE, "readonly");
    const records = (await requestResult(
      transaction.objectStore(OUTBOX_STORE).getAll(),
    )) as StoredPendingUpdate[];
    await transactionComplete(transaction);
    return records
      .map((record) => ({ ...record, update: new Uint8Array(record.update) }))
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.messageId.localeCompare(right.messageId),
      );
  }

  async replacePending(
    scope: RealtimeScope,
    updates: readonly PendingUpdate[],
    replacements: readonly PendingUpdate[],
    options: Readonly<{ allowAttempted?: boolean }> = {},
  ): Promise<boolean> {
    const sourceIds = new Set(updates.map((update) => update.messageId));
    const replacementIds = new Set(
      replacements.map((replacement) => replacement.messageId),
    );
    if (
      updates.length === 0 ||
      sourceIds.size !== updates.length ||
      replacementIds.size !== replacements.length ||
      replacements.some(
        (replacement) =>
          replacement.attemptCount !== 0 ||
          sourceIds.has(replacement.messageId),
      ) ||
      (!options.allowAttempted &&
        updates.some((update) => update.attemptCount !== 0))
    ) {
      return false;
    }
    const database = await this.database(scope);
    const transaction = database.transaction(OUTBOX_STORE, "readwrite", {
      durability: "strict",
    });
    const store = transaction.objectStore(OUTBOX_STORE);
    const current: StoredPendingUpdate[] = [];
    for (const update of updates) {
      const existing = (await requestResult(store.get(update.messageId))) as
        StoredPendingUpdate | undefined;
      if (
        !existing ||
        existing.attemptCount !== update.attemptCount ||
        existing.payloadHash !== update.payloadHash ||
        !updatesEqual(new Uint8Array(existing.update), update.update)
      ) {
        await transactionComplete(transaction);
        return false;
      }
      current.push(existing);
    }
    for (const replacement of replacements) {
      const existingReplacement = (await requestResult(
        store.get(replacement.messageId),
      )) as StoredPendingUpdate | undefined;
      if (existingReplacement) {
        await transactionComplete(transaction);
        return false;
      }
      store.add({
        ...replacement,
        update: new Uint8Array(replacement.update).buffer,
      } satisfies StoredPendingUpdate);
    }
    for (const update of current) store.delete(update.messageId);
    await transactionComplete(transaction);
    return true;
  }

  async markAttempt(
    scope: RealtimeScope,
    messageId: string,
    attemptedAt: number,
  ): Promise<void> {
    const database = await this.database(scope);
    const transaction = database.transaction(OUTBOX_STORE, "readwrite", {
      durability: "strict",
    });
    const store = transaction.objectStore(OUTBOX_STORE);
    const existing = (await requestResult(store.get(messageId))) as
      StoredPendingUpdate | undefined;
    if (existing) {
      store.put({
        ...existing,
        attemptCount: existing.attemptCount + 1,
        lastAttemptAt: attemptedAt,
      } satisfies StoredPendingUpdate);
    }
    await transactionComplete(transaction);
  }

  async acknowledge(
    scope: RealtimeScope,
    messageId: string,
    payloadHash: string,
  ): Promise<PendingUpdateAckResult> {
    const database = await this.database(scope);
    const transaction = database.transaction(OUTBOX_STORE, "readwrite", {
      durability: "strict",
    });
    const store = transaction.objectStore(OUTBOX_STORE);
    const existing = (await requestResult(store.get(messageId))) as
      StoredPendingUpdate | undefined;
    if (!existing) {
      await transactionComplete(transaction);
      return "missing";
    }
    if (existing.payloadHash !== payloadHash) {
      await transactionComplete(transaction);
      return "hash_mismatch";
    }
    store.delete(messageId);
    await transactionComplete(transaction);
    return "acknowledged";
  }

  async readRecoveryCheckpoint(
    scope: RealtimeScope,
  ): Promise<RealtimeRecoveryCheckpoint | null> {
    const database = await this.database(scope);
    const transaction = database.transaction(
      RECOVERY_CHECKPOINT_STORE,
      "readonly",
    );
    const stored = (await requestResult(
      transaction
        .objectStore(RECOVERY_CHECKPOINT_STORE)
        .get(RECOVERY_CHECKPOINT_KEY),
    )) as StoredRecoveryCheckpoint | undefined;
    await transactionComplete(transaction);
    if (!stored) return null;
    const checkpoint = {
      committedSequence: stored.committedSequence,
      stateUpdate: new Uint8Array(stored.stateUpdate),
      payloadHash: stored.payloadHash,
      updatedAt: stored.updatedAt,
    };
    validateRecoveryCheckpoint(checkpoint);
    return checkpoint;
  }

  async advanceRecoveryCheckpoint(
    scope: RealtimeScope,
    checkpoint: RealtimeRecoveryCheckpoint,
  ): Promise<RecoveryCheckpointAdvanceResult> {
    validateRecoveryCheckpoint(checkpoint);
    const database = await this.database(scope);
    const transaction = database.transaction(
      RECOVERY_CHECKPOINT_STORE,
      "readwrite",
      { durability: "strict" },
    );
    const store = transaction.objectStore(RECOVERY_CHECKPOINT_STORE);
    const existing = (await requestResult(
      store.get(RECOVERY_CHECKPOINT_KEY),
    )) as StoredRecoveryCheckpoint | undefined;
    if (existing && existing.committedSequence > checkpoint.committedSequence) {
      await transactionComplete(transaction);
      return "stale";
    }
    if (existing?.committedSequence === checkpoint.committedSequence) {
      const duplicate =
        existing.payloadHash === checkpoint.payloadHash &&
        updatesEqual(
          new Uint8Array(existing.stateUpdate),
          checkpoint.stateUpdate,
        );
      await transactionComplete(transaction);
      return duplicate ? "duplicate" : "conflict";
    }
    store.put({
      id: RECOVERY_CHECKPOINT_KEY,
      ...checkpoint,
      stateUpdate: new Uint8Array(checkpoint.stateUpdate).buffer,
    } satisfies StoredRecoveryCheckpoint);
    await transactionComplete(transaction);
    return "advanced";
  }

  async clear(scope: RealtimeScope): Promise<void> {
    const database = await this.database(scope);
    const transaction = database.transaction(
      [OUTBOX_STORE, RECOVERY_CHECKPOINT_STORE],
      "readwrite",
      { durability: "strict" },
    );
    transaction.objectStore(OUTBOX_STORE).clear();
    transaction.objectStore(RECOVERY_CHECKPOINT_STORE).clear();
    await transactionComplete(transaction);
  }

  async close(): Promise<void> {
    const databases = [...this.databases.values()];
    this.databases.clear();
    const settled = await Promise.allSettled(databases);
    for (const result of settled) {
      if (result.status === "fulfilled") result.value.close();
    }
  }
}

export class MemoryPendingUpdateOutbox implements PendingUpdateOutbox {
  private readonly updates = new Map<string, Map<string, PendingUpdate>>();
  private readonly recoveryCheckpoints = new Map<
    string,
    RealtimeRecoveryCheckpoint
  >();

  async put(scope: RealtimeScope, update: PendingUpdate): Promise<void> {
    const scoped =
      this.updates.get(scopeKey(scope)) ?? new Map<string, PendingUpdate>();
    const existing = scoped.get(update.messageId);
    if (
      existing &&
      (existing.payloadHash !== update.payloadHash ||
        !updatesEqual(existing.update, update.update))
    ) {
      throw new PendingUpdateConflictError();
    }
    if (!existing) scoped.set(update.messageId, cloneUpdate(update));
    this.updates.set(scopeKey(scope), scoped);
  }

  async list(scope: RealtimeScope): Promise<PendingUpdate[]> {
    return [...(this.updates.get(scopeKey(scope))?.values() ?? [])]
      .map(cloneUpdate)
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt ||
          left.messageId.localeCompare(right.messageId),
      );
  }

  async replacePending(
    scope: RealtimeScope,
    updates: readonly PendingUpdate[],
    replacements: readonly PendingUpdate[],
    options: Readonly<{ allowAttempted?: boolean }> = {},
  ): Promise<boolean> {
    const sourceIds = new Set(updates.map((update) => update.messageId));
    const replacementIds = new Set(
      replacements.map((replacement) => replacement.messageId),
    );
    if (
      updates.length === 0 ||
      sourceIds.size !== updates.length ||
      replacementIds.size !== replacements.length ||
      replacements.some(
        (replacement) =>
          replacement.attemptCount !== 0 ||
          sourceIds.has(replacement.messageId),
      ) ||
      (!options.allowAttempted &&
        updates.some((update) => update.attemptCount !== 0))
    ) {
      return false;
    }
    const scoped = this.updates.get(scopeKey(scope));
    if (
      !scoped ||
      replacements.some((replacement) => scoped.has(replacement.messageId))
    ) {
      return false;
    }
    for (const update of updates) {
      const existing = scoped.get(update.messageId);
      if (
        !existing ||
        existing.attemptCount !== update.attemptCount ||
        existing.payloadHash !== update.payloadHash ||
        !updatesEqual(existing.update, update.update)
      ) {
        return false;
      }
    }
    for (const replacement of replacements) {
      scoped.set(replacement.messageId, cloneUpdate(replacement));
    }
    for (const update of updates) scoped.delete(update.messageId);
    return true;
  }

  async markAttempt(
    scope: RealtimeScope,
    messageId: string,
    attemptedAt: number,
  ): Promise<void> {
    const update = this.updates.get(scopeKey(scope))?.get(messageId);
    if (update) {
      update.attemptCount += 1;
      update.lastAttemptAt = attemptedAt;
    }
  }

  async acknowledge(
    scope: RealtimeScope,
    messageId: string,
    payloadHash: string,
  ): Promise<PendingUpdateAckResult> {
    const scoped = this.updates.get(scopeKey(scope));
    const update = scoped?.get(messageId);
    if (!update) return "missing";
    if (update.payloadHash !== payloadHash) return "hash_mismatch";
    scoped?.delete(messageId);
    return "acknowledged";
  }

  async readRecoveryCheckpoint(
    scope: RealtimeScope,
  ): Promise<RealtimeRecoveryCheckpoint | null> {
    const checkpoint = this.recoveryCheckpoints.get(scopeKey(scope));
    return checkpoint ? cloneRecoveryCheckpoint(checkpoint) : null;
  }

  async advanceRecoveryCheckpoint(
    scope: RealtimeScope,
    checkpoint: RealtimeRecoveryCheckpoint,
  ): Promise<RecoveryCheckpointAdvanceResult> {
    validateRecoveryCheckpoint(checkpoint);
    const key = scopeKey(scope);
    const existing = this.recoveryCheckpoints.get(key);
    if (existing && existing.committedSequence > checkpoint.committedSequence) {
      return "stale";
    }
    if (existing?.committedSequence === checkpoint.committedSequence) {
      return existing.payloadHash === checkpoint.payloadHash &&
        updatesEqual(existing.stateUpdate, checkpoint.stateUpdate)
        ? "duplicate"
        : "conflict";
    }
    this.recoveryCheckpoints.set(key, cloneRecoveryCheckpoint(checkpoint));
    return "advanced";
  }

  async clear(scope: RealtimeScope): Promise<void> {
    this.updates.delete(scopeKey(scope));
    this.recoveryCheckpoints.delete(scopeKey(scope));
  }

  async close(): Promise<void> {}
}

export const createIndexedDbDocumentPersistence: DocumentPersistenceFactory = (
  scope: RealtimeScope,
  document: Y.Doc,
): DocumentPersistence | null => {
  if (typeof indexedDB === "undefined") return null;
  const persistence = new IndexeddbPersistence(
    scopedStorageName("document", scope),
    document,
  );
  return {
    origin: persistence,
    whenSynced: persistence.whenSynced.then(() => undefined),
    destroy: () => persistence.destroy(),
    clearData: () => persistence.clearData(),
  };
};

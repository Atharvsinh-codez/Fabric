import type { RecordsDiff } from "tldraw";
import type { TLRecord, TLStore } from "tldraw";
import * as Y from "yjs";

import {
  parseTldrawRecord,
  TldrawRecordBudget,
  type TldrawRecordBudgetChange,
} from "../../boards/tldraw-document";

const TLDRAW_RECORDS_ROOT = "fabric.tldraw.records.v1";
const LOCAL_TLDRAW_ORIGIN = Object.freeze({ source: "fabric-tldraw-store" });
type TLRecordId = TLRecord["id"];

export type TldrawBridgeErrorCode =
  | "apply_failed"
  | "document_limit"
  | "invalid_record"
  | "read_only";

export type TldrawBridgeError = Readonly<{
  code: TldrawBridgeErrorCode;
  message: string;
}>;

export type TldrawYjsBridgeOptions = Readonly<{
  document: Y.Doc;
  store: TLStore;
  canWrite: () => boolean;
  onError?: (error: TldrawBridgeError) => void;
  onLocalStoreChange?: () => void;
  onRemoteStoreChange?: () => void;
}>;

function invokeSafely(callback: (() => void) | undefined): void {
  if (!callback) return;
  try {
    callback();
  } catch {
    // A UI callback cannot be allowed to interrupt the CRDT transaction.
  }
}

function entriesFromDiff(
  diff: RecordsDiff<TLRecord>,
): TldrawRecordBudgetChange[] {
  const entries: TldrawRecordBudgetChange[] = [];
  for (const [id, record] of Object.entries(diff.added)) entries.push([id, record]);
  for (const [id, pair] of Object.entries(diff.updated)) entries.push([id, pair[1]]);
  for (const id of Object.keys(diff.removed)) entries.push([id, null]);
  return entries;
}

export function getTldrawRecordMap(document: Y.Doc): Y.Map<unknown> {
  return document.getMap<unknown>(TLDRAW_RECORDS_ROOT);
}

/**
 * Synchronizes only tldraw's document-scoped records. Session/camera state stays
 * local, while presence is carried by FabricRealtimeClient awareness.
 */
export class TldrawYjsBridge {
  private readonly document: Y.Doc;
  private readonly records: Y.Map<unknown>;
  private readonly store: TLStore;
  private readonly options: TldrawYjsBridgeOptions;
  private destroyed = false;
  private applyingRemote = false;
  private suppressRemoteSideEffects = false;
  private remoteSuppressionEpoch = 0;
  private recordBudget: TldrawRecordBudget | null;
  private readonly unlisten: () => void;

  constructor(options: TldrawYjsBridgeOptions) {
    this.options = options;
    this.document = options.document;
    this.records = getTldrawRecordMap(options.document);
    this.store = options.store;
    this.recordBudget = TldrawRecordBudget.fromRecords(this.records.entries());
    this.records.observe(this.handleYjsRecordsChange);
    this.unlisten = this.store.listen(this.handleLocalStoreChange, {
      source: "user",
      scope: "document",
    });
  }

  get recordCount(): number {
    return this.records.size;
  }

  hasRecords(): boolean {
    return this.records.size > 0;
  }

  /** Applies IndexedDB/server state to the mounted store without producing an echo update. */
  applyAllRecords(): boolean {
    if (this.destroyed || this.records.size === 0) return false;
    const recordBudget = TldrawRecordBudget.fromRecords(this.records.entries());
    if (!recordBudget) {
      this.recordBudget = null;
      this.emitError(
        "document_limit",
        "The collaborative tldraw record set failed Fabric's validation limits.",
      );
      return false;
    }
    this.recordBudget = recordBudget;

    const records: TLRecord[] = [];
    for (const [id, value] of this.records.entries()) {
      const parsed = parseTldrawRecord(id, value);
      if (!parsed) {
        this.emitError("invalid_record", `The collaborative record ${id} is invalid.`);
        return false;
      }
      records.push(parsed as unknown as TLRecord);
    }
    const synchronizedIds = new Set(records.map((record) => record.id));
    const removals = this.store
      .getStoreSnapshot("document")
      .store;
    const removalIds = Object.keys(removals).filter((id) => !synchronizedIds.has(id as TLRecordId));

    try {
      this.applyAsRemote(() => {
        if (removalIds.length > 0) this.store.remove(removalIds as TLRecordId[]);
        if (records.length > 0) this.store.put(records);
      });
      invokeSafely(this.options.onRemoteStoreChange);
      return true;
    } catch {
      this.emitError(
        "apply_failed",
        "Fabric could not apply the collaborative tldraw document to this editor.",
      );
      return false;
    }
  }

  /** Seeds a genuinely empty realtime room from the already hydrated HTTP checkpoint. */
  seedFromStore(): boolean {
    if (this.destroyed || this.records.size > 0 || !this.options.canWrite()) return false;
    const snapshot = this.store.getStoreSnapshot("document").store;
    const recordBudget = TldrawRecordBudget.fromRecords(Object.entries(snapshot));
    if (!recordBudget) {
      this.emitError(
        "document_limit",
        "This tldraw document is too large or contains a record Fabric cannot synchronize.",
      );
      return false;
    }
    this.document.transact(() => {
      for (const [id, record] of Object.entries(snapshot)) {
        const parsed = parseTldrawRecord(id, record);
        if (parsed) this.records.set(id, parsed);
      }
    }, LOCAL_TLDRAW_ORIGIN);
    this.recordBudget = recordBudget;
    return this.records.size > 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.records.unobserve(this.handleYjsRecordsChange);
    this.unlisten();
  }

  private readonly handleLocalStoreChange = ({
    changes,
  }: {
    changes: RecordsDiff<TLRecord>;
  }): void => {
    if (this.destroyed || this.applyingRemote || this.suppressRemoteSideEffects) return;
    if (!this.options.canWrite()) {
      this.revertLocalChanges(changes);
      this.emitError("read_only", "This board is read-only, so the local edit was reverted.");
      return;
    }

    const recordBudget =
      this.recordBudget ?? TldrawRecordBudget.fromRecords(this.records.entries());
    if (!recordBudget) {
      this.revertLocalChanges(changes);
      this.emitError(
        "document_limit",
        "The local edit could not be checked against the current tldraw document limits.",
      );
      return;
    }
    this.recordBudget = recordBudget;
    const prepared = recordBudget.prepareChanges(entriesFromDiff(changes));
    if (!prepared.ok) {
      this.revertLocalChanges(changes);
      if (prepared.reason === "invalid_record") {
        this.emitError("invalid_record", "A local tldraw record failed validation.");
      } else {
        this.emitError(
          "document_limit",
          "The local edit exceeded Fabric's tldraw document safety limits and was reverted.",
        );
      }
      return;
    }

    try {
      this.document.transact(() => {
        for (const [id, record] of prepared.entries) {
          if (record) this.records.set(id, record);
          else this.records.delete(id);
        }
      }, LOCAL_TLDRAW_ORIGIN);
      prepared.commit();
    } catch (error) {
      this.recordBudget = TldrawRecordBudget.fromRecords(this.records.entries());
      throw error;
    }
    invokeSafely(this.options.onLocalStoreChange);
  };

  private readonly handleYjsRecordsChange = (
    event: Y.YMapEvent<unknown>,
    transaction: Y.Transaction,
  ): void => {
    if (this.destroyed || transaction.origin === LOCAL_TLDRAW_ORIGIN) return;
    const recordBudget = TldrawRecordBudget.fromRecords(this.records.entries());
    if (!recordBudget) {
      this.recordBudget = null;
      this.emitError(
        "document_limit",
        "A remote tldraw update exceeded Fabric's document safety limits and was ignored.",
      );
      return;
    }
    this.recordBudget = recordBudget;

    const puts: TLRecord[] = [];
    const removals: TLRecordId[] = [];
    for (const id of event.keysChanged) {
      const value = this.records.get(id);
      if (value === undefined) {
        if (this.store.has(id as TLRecordId)) removals.push(id as TLRecordId);
        continue;
      }
      const parsed = parseTldrawRecord(id, value);
      if (!parsed) {
        this.emitError("invalid_record", `A remote tldraw record ${id} was ignored.`);
        return;
      }
      puts.push(parsed as unknown as TLRecord);
    }

    try {
      this.applyAsRemote(() => {
        if (removals.length > 0) this.store.remove(removals);
        if (puts.length > 0) this.store.put(puts);
      });
      invokeSafely(this.options.onRemoteStoreChange);
    } catch {
      this.emitError(
        "apply_failed",
        "Fabric could not apply a remote tldraw change to this editor.",
      );
    }
  };

  private revertLocalChanges(changes: RecordsDiff<TLRecord>): void {
    const addedIds = Object.keys(changes.added) as TLRecordId[];
    const previousRecords: TLRecord[] = [
      ...Object.values(changes.updated).map(([previous]) => previous),
      ...Object.values(changes.removed),
    ];
    this.applyAsRemote(() => {
      if (addedIds.length > 0) this.store.remove(addedIds);
      if (previousRecords.length > 0) this.store.put(previousRecords);
    });
  }

  private applyAsRemote(apply: () => void): void {
    const wasApplyingRemote = this.applyingRemote;
    this.applyingRemote = true;
    this.suppressRemoteSideEffects = true;
    const suppressionEpoch = ++this.remoteSuppressionEpoch;
    try {
      this.store.mergeRemoteChanges(apply);
    } finally {
      this.applyingRemote = wasApplyingRemote;
      queueMicrotask(() => {
        if (this.remoteSuppressionEpoch === suppressionEpoch) {
          this.suppressRemoteSideEffects = false;
        }
      });
    }
  }

  private emitError(code: TldrawBridgeErrorCode, message: string): void {
    try {
      this.options.onError?.({ code, message });
    } catch {
      // Error presentation is not part of the consistency boundary.
    }
  }
}

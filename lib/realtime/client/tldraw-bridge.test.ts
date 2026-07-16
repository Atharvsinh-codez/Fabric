import {
  DocumentRecordType,
  PageRecordType,
  TLDOCUMENT_ID,
  ZERO_INDEX_KEY,
  createTLStore,
  type TLPageId,
} from "tldraw";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { getTldrawRecordMap, TldrawYjsBridge } from "./tldraw-bridge";

function createDocumentStore() {
  const store = createTLStore();
  const document = DocumentRecordType.create({ id: TLDOCUMENT_ID });
  const page = PageRecordType.create({
    id: "page:main" as TLPageId,
    name: "Main",
    index: ZERO_INDEX_KEY,
  });
  store.put([document, page]);
  return { store, page };
}

describe("TldrawYjsBridge", () => {
  it("applies remote records and deletions without echoing them back to Yjs", () => {
    const { store, page } = createDocumentStore();
    const document = new Y.Doc();
    const bridge = new TldrawYjsBridge({
      document,
      store,
      canWrite: () => true,
    });
    expect(bridge.seedFromStore()).toBe(true);
    const records = getTldrawRecordMap(document);
    let yjsUpdateCount = 0;
    const origins: unknown[] = [];
    document.on("update", (_update, origin) => {
      yjsUpdateCount += 1;
      origins.push(origin);
    });

    document.transact(() => {
      records.set(page.id, { ...page, name: "Remote page" });
    }, { source: "server" });

    expect(store.get(page.id)?.name).toBe("Remote page");
    expect(yjsUpdateCount).toBe(1);

    document.transact(() => {
      records.delete(page.id);
    }, { source: "server" });

    expect(store.has(page.id)).toBe(false);
    expect(yjsUpdateCount).toBe(2);
    expect(origins).toEqual([{ source: "server" }, { source: "server" }]);
    expect(records.has("page:page")).toBe(false);
    bridge.destroy();
    document.destroy();
  });

  it("writes local user document records once and reverts edits in read-only mode", () => {
    const writable = createDocumentStore();
    const writableDocument = new Y.Doc();
    const localChange = vi.fn();
    const writableBridge = new TldrawYjsBridge({
      document: writableDocument,
      store: writable.store,
      canWrite: () => true,
      onLocalStoreChange: localChange,
    });
    writableBridge.seedFromStore();
    const writableRecords = getTldrawRecordMap(writableDocument);
    const fullScan = vi.spyOn(writableRecords, "entries");
    const changed = { ...writable.page, name: "Local page" };
    writable.store.put([changed]);

    expect(writableRecords.get(changed.id)).toEqual(changed);
    expect(fullScan).not.toHaveBeenCalled();
    expect(localChange).toHaveBeenCalledTimes(1);

    const readonly = createDocumentStore();
    const readonlyDocument = new Y.Doc();
    const error = vi.fn();
    const readonlyBridge = new TldrawYjsBridge({
      document: readonlyDocument,
      store: readonly.store,
      canWrite: () => false,
      onError: error,
    });
    const forbidden = PageRecordType.create({
      id: "page:forbidden" as TLPageId,
      name: "Forbidden",
      index: ZERO_INDEX_KEY,
    });
    readonly.store.put([forbidden]);

    expect(readonly.store.has(forbidden.id)).toBe(false);
    expect(getTldrawRecordMap(readonlyDocument).has(forbidden.id)).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "read_only" }),
    );

    writableBridge.destroy();
    readonlyBridge.destroy();
    writableDocument.destroy();
    readonlyDocument.destroy();
  });
});

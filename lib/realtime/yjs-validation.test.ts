import { describe, expect, it } from "vitest";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

import {
  decodeAndValidateAwarenessUpdate,
  encodeServerAuthoritativeAwarenessUpdate,
  validateYjsUpdate,
} from "./yjs-validation";

describe("Yjs realtime validation", () => {
  it("accepts a valid Yjs update without mutating the current room document", () => {
    const room = new Y.Doc();
    const client = new Y.Doc();
    client.getMap("board").set("title", "Research synthesis");
    const update = Y.encodeStateAsUpdate(client);

    validateYjsUpdate(room, update);
    expect(room.getMap("board").get("title")).toBeUndefined();

    room.destroy();
    client.destroy();
  });

  it("allows only the approved ephemeral awareness fields", () => {
    const document = new Y.Doc();
    const awareness = new Awareness(document);
    awareness.setLocalState({
      cursor: { x: 12, y: 40 },
      selectionIds: ["note-1"],
      editing: true,
    });
    const valid = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    expect(decodeAndValidateAwarenessUpdate(valid)[0]?.state).toMatchObject({
      editing: true,
    });

    awareness.setLocalState({ displayLabel: "Forged name", avatarColor: "#ffffff" });
    const forgedIdentity = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    expect(() => decodeAndValidateAwarenessUpdate(forgedIdentity)).toThrow();

    awareness.setLocalState({ email: "private@example.com" });
    const invalid = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    expect(() => decodeAndValidateAwarenessUpdate(invalid)).toThrow();

    awareness.destroy();
    document.destroy();
  });

  it("binds remote presence identity and color on the server", () => {
    const document = new Y.Doc();
    const receiverDocument = new Y.Doc();
    const sender = new Awareness(document);
    const receiver = new Awareness(receiverDocument);
    sender.setLocalState({ cursor: { x: 1, y: 2 } });
    const [entry] = decodeAndValidateAwarenessUpdate(
      encodeAwarenessUpdate(sender, [sender.clientID]),
    );
    const update = encodeServerAuthoritativeAwarenessUpdate(entry!, {
      principalId: "11111111-1111-4111-8111-111111111111",
      clientInstanceId: "22222222-2222-4222-8222-222222222222",
      displayLabel: "Ada Lovelace",
    });

    applyAwarenessUpdate(receiver, update, "test");
    expect(receiver.getStates().get(sender.clientID)).toMatchObject({
      principalId: "11111111-1111-4111-8111-111111111111",
      clientInstanceId: "22222222-2222-4222-8222-222222222222",
      displayLabel: "Ada Lovelace",
      avatarColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
      cursor: { x: 1, y: 2 },
    });
    sender.destroy();
    receiver.destroy();
    document.destroy();
    receiverDocument.destroy();
  });
});

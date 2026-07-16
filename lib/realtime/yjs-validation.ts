import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import {
  applyAwarenessUpdate,
  type Awareness,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { z } from "zod";

import {
  authoritativePresenceColor,
  sanitizePresenceDisplayLabel,
} from "./presence-identity";

const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const awarenessStateSchema = z
  .object({
    cursor: z.object({ x: coordinate, y: coordinate }).strict().optional(),
    viewport: z
      .object({
        x: coordinate,
        y: coordinate,
        width: z.number().finite().positive().max(10_000_000),
        height: z.number().finite().positive().max(10_000_000),
      })
      .strict()
      .optional(),
    selectionIds: z.array(z.string().min(1).max(128)).max(100).optional(),
    editing: z.boolean().optional(),
  })
  .strict();

export type DecodedAwarenessEntry = {
  clientId: number;
  clock: number;
  state: z.infer<typeof awarenessStateSchema> | null;
};

export function encodeServerAuthoritativeAwarenessUpdate(
  entry: DecodedAwarenessEntry,
  identity: Readonly<{
    principalId: string;
    clientInstanceId: string;
    displayLabel: string;
  }>,
): Uint8Array {
  const state =
    entry.state === null
      ? null
      : {
          ...entry.state,
          principalId: identity.principalId,
          clientInstanceId: identity.clientInstanceId,
          displayLabel: sanitizePresenceDisplayLabel(identity.displayLabel),
          avatarColor: authoritativePresenceColor(identity.principalId),
        };
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint(encoder, entry.clientId);
  encoding.writeVarUint(encoder, entry.clock);
  encoding.writeVarString(encoder, JSON.stringify(state));
  return encoding.toUint8Array(encoder);
}

export function validateYjsUpdate(currentDocument: Y.Doc, update: Uint8Array): void {
  const candidate = new Y.Doc({ gc: true });
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(currentDocument));
    Y.applyUpdate(candidate, update);
  } finally {
    candidate.destroy();
  }
}

export function decodeAndValidateAwarenessUpdate(
  update: Uint8Array,
): DecodedAwarenessEntry[] {
  const decoder = decoding.createDecoder(update);
  const length = decoding.readVarUint(decoder);
  if (length < 1 || length > 1) {
    throw new Error("Each awareness update must control exactly one client identity.");
  }

  const entries: DecodedAwarenessEntry[] = [];
  for (let index = 0; index < length; index += 1) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const rawState = JSON.parse(decoding.readVarString(decoder)) as unknown;
    const state = rawState === null ? null : awarenessStateSchema.parse(rawState);
    entries.push({ clientId, clock, state });
  }

  if (decoding.hasContent(decoder)) {
    throw new Error("The awareness update contains trailing data.");
  }
  return entries;
}

export function applyValidatedAwarenessUpdate(
  awareness: Awareness,
  update: Uint8Array,
  origin: unknown,
): DecodedAwarenessEntry[] {
  const entries = decodeAndValidateAwarenessUpdate(update);
  applyAwarenessUpdate(awareness, update, origin);
  return entries;
}

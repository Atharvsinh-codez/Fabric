import "server-only";

import { createHash } from "node:crypto";

import { PAGINATION_CURSOR_MAX_CHARS } from "@/lib/boards/pagination-contract";

const CURSOR_VERSION = 1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVITY_ID_PATTERN =
  /^(?:board|comment|member):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRECISE_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export class InvalidPaginationCursorError extends Error {
  constructor() {
    super("The pagination cursor is invalid or belongs to another query.");
    this.name = "InvalidPaginationCursorError";
  }
}

type CursorEnvelope = Readonly<{
  v: number;
  k: "boards" | "activity";
  s: string;
  p?: 0 | 1;
  t: string;
  i: string;
}>;

export type BoardListCursor = Readonly<{
  pinned: boolean;
  sortAt: string;
  id: string;
}>;

export type ActivityCursor = Readonly<{
  occurredAt: string;
  id: string;
}>;

export function paginationScope(parts: readonly unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("base64url");
}

function encode(envelope: CursorEnvelope): string {
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function decode(value: string): CursorEnvelope {
  if (
    value.length < 1 ||
    value.length > PAGINATION_CURSOR_MAX_CHARS ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new InvalidPaginationCursorError();
  }
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object") {
      throw new InvalidPaginationCursorError();
    }
    const cursor = parsed as Partial<CursorEnvelope>;
    if (
      cursor.v !== CURSOR_VERSION ||
      (cursor.k !== "boards" && cursor.k !== "activity") ||
      typeof cursor.s !== "string" ||
      typeof cursor.t !== "string" ||
      typeof cursor.i !== "string"
    ) {
      throw new InvalidPaginationCursorError();
    }
    const envelope = cursor as CursorEnvelope;
    if (encode(envelope) !== value) {
      throw new InvalidPaginationCursorError();
    }
    return envelope;
  } catch (error) {
    if (error instanceof InvalidPaginationCursorError) throw error;
    throw new InvalidPaginationCursorError();
  }
}

function exactTimestamp(value: string): string {
  if (!PRECISE_TIMESTAMP_PATTERN.test(value)) {
    throw new InvalidPaginationCursorError();
  }
  const millisecondIso = `${value.slice(0, 23)}Z`;
  const date = new Date(millisecondIso);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== millisecondIso
  ) {
    throw new InvalidPaginationCursorError();
  }
  return value;
}

export function encodeBoardListCursor(
  cursor: BoardListCursor,
  scope: string,
): string {
  return encode({
    v: CURSOR_VERSION,
    k: "boards",
    s: scope,
    p: cursor.pinned ? 1 : 0,
    t: exactTimestamp(cursor.sortAt),
    i: cursor.id,
  });
}

export function decodeBoardListCursor(
  value: string,
  scope: string,
): BoardListCursor {
  const cursor = decode(value);
  if (
    cursor.k !== "boards" ||
    cursor.s !== scope ||
    (cursor.p !== 0 && cursor.p !== 1) ||
    !UUID_PATTERN.test(cursor.i)
  ) {
    throw new InvalidPaginationCursorError();
  }
  return {
    pinned: cursor.p === 1,
    sortAt: exactTimestamp(cursor.t),
    id: cursor.i,
  };
}

export function encodeActivityCursor(
  cursor: ActivityCursor,
  scope: string,
): string {
  return encode({
    v: CURSOR_VERSION,
    k: "activity",
    s: scope,
    t: exactTimestamp(cursor.occurredAt),
    i: cursor.id,
  });
}

export function decodeActivityCursor(
  value: string,
  scope: string,
): ActivityCursor {
  const cursor = decode(value);
  if (
    cursor.k !== "activity" ||
    cursor.s !== scope ||
    cursor.p !== undefined ||
    !ACTIVITY_ID_PATTERN.test(cursor.i)
  ) {
    throw new InvalidPaginationCursorError();
  }
  return {
    occurredAt: exactTimestamp(cursor.t),
    id: cursor.i,
  };
}

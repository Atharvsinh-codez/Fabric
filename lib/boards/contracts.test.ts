import { describe, expect, it } from "vitest";

import {
  AddWorkspaceMemberSchema,
  BoardDocumentSchema,
  CreateCommentSchema,
  CreateBoardSchema,
  CreateProjectSchema,
  ListBoardsQuerySchema,
  UpdateBoardMetadataSchema,
  UpdateBoardDocumentSchema,
} from "./contracts";
import {
  BOARD_LIST_DEFAULT_PAGE_SIZE,
  BOARD_LIST_MAX_PAGE_SIZE,
  PAGINATION_CURSOR_MAX_CHARS,
} from "./pagination-contract";

describe("board API contracts", () => {
  it("accepts a finite JSON board document", () => {
    expect(
      BoardDocumentSchema.safeParse({ version: 1, nodes: [{ id: "note-1", x: 12 }] }).success,
    ).toBe(true);
  });

  it("rejects reserved prototype keys and non-finite values", () => {
    const reserved = JSON.parse('{"constructor":{"polluted":true}}') as unknown;
    expect(BoardDocumentSchema.safeParse(reserved).success).toBe(false);
    expect(BoardDocumentSchema.safeParse({ zoom: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("requires both optimistic-concurrency tokens", () => {
    expect(
      UpdateBoardDocumentSchema.safeParse({
        expectedRevision: 2,
        expectedDocumentGenerationId: "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f",
        document: { version: 1 },
      }).success,
    ).toBe(true);
    expect(
      UpdateBoardDocumentSchema.safeParse({
        expectedRevision: 2,
        document: { version: 1 },
      }).success,
    ).toBe(false);
  });

  it("separates new threads from replies", () => {
    expect(
      CreateCommentSchema.safeParse({ kind: "thread", anchor: { nodeId: "note-1" }, body: "Review" })
        .success,
    ).toBe(true);
    expect(
      CreateCommentSchema.safeParse({ kind: "reply", body: "Missing thread id" }).success,
    ).toBe(false);
  });

  it("accepts a normalized member email instead of exposing a user id", () => {
    expect(
      AddWorkspaceMemberSchema.parse({
        email: "  Teammate@Example.com ",
        role: "editor",
      }),
    ).toEqual({ email: "teammate@example.com", role: "editor" });
    expect(
      AddWorkspaceMemberSchema.safeParse({
        userId: "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f",
        role: "editor",
      }).success,
    ).toBe(false);
  });

  it("accepts only supported themes when creating a board", () => {
    const base = {
      workspaceId: "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f",
      title: "Planning board",
    };
    expect(CreateBoardSchema.safeParse({ ...base, theme: "grid" }).success).toBe(true);
    expect(CreateBoardSchema.safeParse({ ...base, theme: "neon" }).success).toBe(false);
  });

  it("requires every board list to be scoped to a workspace", () => {
    expect(ListBoardsQuerySchema.safeParse({ view: "recent" }).success).toBe(false);
    expect(
      ListBoardsQuerySchema.parse({
        workspaceId: "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f",
        view: "pinned",
        status: "review",
      }).limit,
    ).toBe(BOARD_LIST_DEFAULT_PAGE_SIZE);
  });

  it("bounds board pages and opaque cursors", () => {
    const base = {
      workspaceId: "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f",
    };
    expect(
      ListBoardsQuerySchema.safeParse({
        ...base,
        limit: BOARD_LIST_MAX_PAGE_SIZE,
        cursor: "opaque-cursor",
      }).success,
    ).toBe(true);
    expect(
      ListBoardsQuerySchema.safeParse({
        ...base,
        limit: BOARD_LIST_MAX_PAGE_SIZE + 1,
      }).success,
    ).toBe(false);
    expect(
      ListBoardsQuerySchema.safeParse({
        ...base,
        cursor: "x".repeat(PAGINATION_CURSOR_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it("bounds project and board organization metadata", () => {
    expect(
      CreateProjectSchema.safeParse({
        name: "Launch",
        icon: "target",
        defaultSharingPolicy: "project",
      }).success,
    ).toBe(true);
    expect(
      UpdateBoardMetadataSchema.safeParse({
        status: "review",
        sharingPolicy: "private",
        cover: { kind: "preset", value: "sky" },
      }).success,
    ).toBe(true);
    expect(UpdateBoardMetadataSchema.safeParse({ status: "archived" }).success).toBe(false);
    expect(
      UpdateBoardMetadataSchema.safeParse({
        cover: {
          kind: "asset",
          assetId: "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f",
        },
      }).success,
    ).toBe(true);
  });
});

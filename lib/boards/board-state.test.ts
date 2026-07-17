import { describe, expect, it } from "vitest";

import {
  canCommentOnBoardState,
  canEditBoardState,
  deriveBoardStatus,
  mergeBoardMetadataPreservingLocalDocument,
  resolveBoardSessionAccess,
} from "./board-state";
import type { BoardDetail } from "./client";

describe("derived board lifecycle state", () => {
  it("preserves the stored workflow status while presenting archived boards as archived", () => {
    expect(deriveBoardStatus("review", null)).toBe("review");
    expect(deriveBoardStatus("review", "2026-07-15T00:00:00.000Z")).toBe(
      "archived",
    );
  });

  it("makes every archived board read-only without weakening its stored role", () => {
    expect(canEditBoardState({ role: "owner", archivedAt: new Date() })).toBe(
      false,
    );
    expect(
      canCommentOnBoardState({ role: "commenter", archivedAt: new Date() }),
    ).toBe(false);
    expect(canEditBoardState({ role: "editor", archivedAt: null })).toBe(true);
    expect(canCommentOnBoardState({ role: "commenter", archivedAt: null })).toBe(
      true,
    );
  });

  it("keeps legitimate offline editing enabled during transient reconnects", () => {
    expect(
      resolveBoardSessionAccess({
        role: "editor",
        archivedAt: null,
        realtimeCapabilities: ["read", "write", "awareness"],
        realtimeWriteEnabled: true,
        realtimeAccessLost: false,
        accessLost: false,
      }),
    ).toMatchObject({
      canEdit: true,
      canManageSharing: false,
      shouldRefreshAccess: false,
    });
  });

  it("keeps an authorized local-first editor writable while realtime authorization is unresolved", () => {
    expect(
      resolveBoardSessionAccess({
        role: "editor",
        archivedAt: null,
        realtimeCapabilities: [],
        realtimeWriteEnabled: true,
        realtimeAccessLost: false,
        accessLost: false,
      }),
    ).toMatchObject({
      canEdit: true,
      canComment: true,
      shouldRefreshAccess: false,
    });
  });

  it("stops stale writable/admin UI for a resolved read-only capability set", () => {
    expect(
      resolveBoardSessionAccess({
        role: "owner",
        archivedAt: null,
        realtimeCapabilities: ["read", "awareness"],
        realtimeWriteEnabled: false,
        realtimeAccessLost: false,
        accessLost: false,
      }),
    ).toEqual({
      canEdit: false,
      canComment: true,
      canManageSharing: false,
      shouldRefreshAccess: true,
    });
  });

  it("uses the exact HTTP role for comments instead of guessing from realtime read access", () => {
    const commenter = resolveBoardSessionAccess({
      role: "commenter",
      archivedAt: null,
      realtimeCapabilities: ["read", "awareness"],
      realtimeWriteEnabled: false,
      realtimeAccessLost: false,
      accessLost: false,
    });
    const viewer = resolveBoardSessionAccess({
      role: "viewer",
      archivedAt: null,
      realtimeCapabilities: ["read", "awareness"],
      realtimeWriteEnabled: false,
      realtimeAccessLost: false,
      accessLost: false,
    });

    expect(commenter.canComment).toBe(true);
    expect(viewer.canComment).toBe(false);
    expect(commenter.shouldRefreshAccess).toBe(false);
  });

  it("blocks all interactive access while an explicit realtime loss is unverified", () => {
    expect(
      resolveBoardSessionAccess({
        role: "commenter",
        archivedAt: null,
        realtimeCapabilities: [],
        realtimeWriteEnabled: false,
        realtimeAccessLost: true,
        accessLost: false,
      }),
    ).toEqual({
      canEdit: false,
      canComment: false,
      canManageSharing: false,
      shouldRefreshAccess: true,
    });
  });

  it("removes administration after ownership refresh without disabling inherited editor access", () => {
    expect(
      resolveBoardSessionAccess({
        role: "editor",
        archivedAt: null,
        realtimeCapabilities: ["read", "write", "awareness"],
        realtimeWriteEnabled: true,
        realtimeAccessLost: false,
        accessLost: false,
      }),
    ).toMatchObject({
      canEdit: true,
      canManageSharing: false,
    });
  });

  it("preserves a local document and recovery base while refreshing ownership metadata", () => {
    const current = boardDetail({
      ownerId: "previous-owner",
      role: "owner",
      revision: 7,
      documentGenerationId: "generation-local",
      document: { marker: "local-draft" },
    });
    const remote = boardDetail({
      ownerId: "next-owner",
      role: "editor",
      revision: 12,
      documentGenerationId: "generation-remote",
      document: { marker: "remote-checkpoint" },
    });

    const refreshed = mergeBoardMetadataPreservingLocalDocument(current, remote);

    expect(refreshed).toMatchObject({
      ownerId: "next-owner",
      role: "editor",
      revision: 7,
      documentGenerationId: "generation-local",
      document: { marker: "local-draft" },
    });
  });
});

function boardDetail(overrides: Partial<BoardDetail> = {}): BoardDetail {
  return {
    id: "board-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    projectName: "Project",
    ownerId: "owner-1",
    title: "Board",
    cover: null,
    status: "active",
    sharingPolicy: "workspace",
    revision: 1,
    documentGenerationId: "generation-1",
    role: "owner",
    favorite: false,
    pinned: false,
    lastOpenedAt: null,
    archivedAt: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    document: { marker: "remote" },
    ...overrides,
  };
}

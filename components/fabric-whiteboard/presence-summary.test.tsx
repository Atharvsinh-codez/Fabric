// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CurrentUserProvider } from "@/components/current-user-provider";
import type { RealtimeAwarenessState } from "@/lib/realtime/client/types";
import { PresenceSummary } from "./presence-summary";

const mocks = vi.hoisted(() => ({
  listWorkspaceMembers: vi.fn(),
}));

vi.mock("@/lib/boards/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/boards/client")>()),
  listWorkspaceMembers: mocks.listWorkspaceMembers,
}));

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCAL_USER = {
  id: "99999999-9999-4999-8999-999999999999",
  name: "Local Editor",
  email: "local@example.com",
  image: null,
};

function authoritativePresence(
  principalId: string,
  clientInstanceId: string,
  displayLabel: string,
  avatarColor: "#0284c7" | "#7c3aed",
): RealtimeAwarenessState {
  return {
    serverAuthoritative: true,
    principalId,
    clientInstanceId,
    displayLabel,
    avatarColor,
  };
}

describe("whiteboard presence summary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.listWorkspaceMembers.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderPresence(awarenessStates: ReadonlyMap<number, RealtimeAwarenessState>) {
    act(() => {
      root.render(
        <CurrentUserProvider user={LOCAL_USER}>
          <PresenceSummary
            workspaceId={WORKSPACE_ID}
            awarenessStates={awarenessStates}
            localAwarenessClientId={11}
          />
        </CurrentUserProvider>,
      );
    });
  }

  it("opens a compact people panel with the current and remote identities", async () => {
    const adaId = "11111111-1111-4111-8111-111111111111";
    const graceId = "33333333-3333-4333-8333-333333333333";
    mocks.listWorkspaceMembers.mockResolvedValue([
      {
        userId: adaId,
        role: "editor",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: null,
        createdAt: "2026-07-17T00:00:00.000Z",
      },
      {
        userId: graceId,
        role: "viewer",
        name: "Grace Hopper",
        email: "grace@example.com",
        image: null,
        createdAt: "2026-07-17T00:00:00.000Z",
      },
    ]);
    renderPresence(new Map([
      [11, {}],
      [22, authoritativePresence(
        adaId,
        "22222222-2222-4222-8222-222222222222",
        "Ada Lovelace",
        "#0284c7",
      )],
      [33, authoritativePresence(
        graceId,
        "44444444-4444-4444-8444-444444444444",
        "Grace Hopper",
        "#7c3aed",
      )],
    ]));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="3 collaborators online. Show people"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    const panel = container.querySelector<HTMLElement>(
      '[aria-label="People online"]',
    );
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("fixed");
    expect(panel?.className).toContain("inset-x-2");
    expect(panel?.className).toContain("max-[419px]:top-24");
    expect(panel?.className).toContain("max-h-[calc(100dvh_-_4rem)]");
    const peopleList = panel?.querySelector<HTMLElement>('ul[role="list"]');
    expect(peopleList?.className).toContain("min-h-0");
    expect(peopleList?.className).toContain("flex-1");
    expect(peopleList?.className).toContain("overflow-y-auto");
    expect(container.textContent).toContain("Local Editor (You)");
    expect(container.textContent).toContain("local@example.com");
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Grace Hopper");
    expect(container.textContent).toContain("grace@example.com");
    expect(mocks.listWorkspaceMembers).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("counts people rather than duplicate tabs and keeps redacted emails private", async () => {
    const adaId = "11111111-1111-4111-8111-111111111111";
    mocks.listWorkspaceMembers.mockResolvedValue([{
      userId: adaId,
      role: "editor",
      name: "Ada Lovelace",
      image: null,
      createdAt: "2026-07-17T00:00:00.000Z",
    }]);
    renderPresence(new Map([
      [11, {}],
      [22, authoritativePresence(
        adaId,
        "22222222-2222-4222-8222-222222222222",
        "Ada Lovelace",
        "#0284c7",
      )],
      [23, authoritativePresence(
        adaId,
        "55555555-5555-4555-8555-555555555555",
        "Ada Lovelace",
        "#0284c7",
      )],
      [24, authoritativePresence(
        LOCAL_USER.id,
        "66666666-6666-4666-8666-666666666666",
        "Local Editor",
        "#7c3aed",
      )],
    ]));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="2 collaborators online. Show people"]',
    );
    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent?.match(/Ada Lovelace/g)).toHaveLength(1);
    expect(container.textContent?.match(/Local Editor/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("ada@example.com");
  });

  it("does not trust forged browser identity in the people panel", async () => {
    mocks.listWorkspaceMembers.mockResolvedValue([]);
    renderPresence(new Map([
      [11, {}],
      [22, {
        principalId: "11111111-1111-4111-8111-111111111111",
        displayLabel: "Forged Person",
        email: "forged@example.com",
        avatarColor: "#0284c7",
      } as RealtimeAwarenessState],
    ]));

    const trigger = container.querySelector<HTMLButtonElement>("button");
    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Collaborator");
    expect(container.textContent).not.toContain("Forged Person");
    expect(container.textContent).not.toContain("forged@example.com");
  });

  it("stays clickable when the current user is the only person online", () => {
    renderPresence(new Map([[11, {}]]));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="1 collaborator online. Show people"]',
    );
    act(() => trigger?.click());

    expect(container.textContent).toContain("1 person is on this board.");
    expect(container.textContent).toContain("Local Editor (You)");
    expect(container.textContent).toContain("local@example.com");
    expect(mocks.listWorkspaceMembers).not.toHaveBeenCalled();
  });
});

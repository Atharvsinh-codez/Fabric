// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RealtimeAwarenessState } from "@/lib/realtime/client/types";
import { PresenceSummary } from "./presence-summary";

describe("whiteboard presence summary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the total number of people on the board, including the local editor", () => {
    const awareness = new Map<number, RealtimeAwarenessState>([
      [11, { displayLabel: "Local Editor", avatarColor: "#0ea5e9" }],
      [22, {
        serverAuthoritative: true,
        principalId: "11111111-1111-4111-8111-111111111111",
        clientInstanceId: "22222222-2222-4222-8222-222222222222",
        displayLabel: "Ada Lovelace",
        avatarColor: "#0284c7",
      }],
      [33, {
        serverAuthoritative: true,
        principalId: "33333333-3333-4333-8333-333333333333",
        clientInstanceId: "44444444-4444-4444-8444-444444444444",
        displayLabel: "Grace Hopper",
        avatarColor: "#7c3aed",
      }],
    ]);

    act(() => {
      root.render(
        <PresenceSummary
          awarenessStates={awareness}
          localAwarenessClientId={11}
        />,
      );
    });

    expect(
      container.querySelector('[aria-label="3 collaborators online"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("3 online");
    expect(container.textContent).toContain("AL");
    expect(container.textContent).toContain("GH");
    expect(container.textContent).not.toContain("LE");
  });

  it("stays out of the toolbar when nobody else is connected", () => {
    act(() => {
      root.render(
        <PresenceSummary
          awarenessStates={new Map([
            [11, { displayLabel: "Local Editor", avatarColor: "#0ea5e9" }],
          ])}
          localAwarenessClientId={11}
        />,
      );
    });

    expect(container.textContent).toBe("");
  });
});

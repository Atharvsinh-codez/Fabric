// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FabricAiTrigger,
  shouldOpenSyncRecoveryOnLeave,
} from "./status-controls";

describe("whiteboard status controls", () => {
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

  function render(node: ReactNode) {
    act(() => root.render(node));
  }

  it("opens and closes the single Fabric agent sidebar from an accessible trigger", () => {
    const onClick = vi.fn();
    render(
      <FabricAiTrigger
        panelOpen={false}
        busy={false}
        onClick={onClick}
      />,
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open Fabric agent"]',
    );
    expect(trigger?.getAttribute("aria-controls")).toBe(
      "fabric-ai-assistance-panel",
    );
    expect(trigger?.getAttribute("aria-pressed")).toBe("false");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-busy")).toBe("false");
    expect(trigger?.querySelector("[data-wave-spinner]")).toBeNull();

    act(() => trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps Fabric agent unavailable when editing is not authorized", () => {
    render(
      <FabricAiTrigger
        panelOpen={false}
        busy={false}
        disabled
        onClick={() => undefined}
      />,
    );

    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Open Fabric agent"]',
      )?.disabled,
    ).toBe(true);
  });

  it("uses only the Ripple micro-loader while Fabric agent is busy", () => {
    render(
      <FabricAiTrigger
        panelOpen
        busy
        onClick={() => undefined}
      />,
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Close Fabric agent"]',
    );
    const spinner = container.querySelector<HTMLElement>("[data-wave-spinner]");
    expect(trigger?.getAttribute("aria-busy")).toBe("true");
    expect(spinner?.dataset.animation).toBe("ripple");
    expect(spinner?.dataset.pattern).toBe("square3x3");
    expect(
      trigger?.querySelector('[data-wave-spinner]:not([data-animation="ripple"])'),
    ).toBeNull();
  });

  it("offers recovery only when an actionable sync state meets a leave attempt", () => {
    expect(shouldOpenSyncRecoveryOnLeave("synced")).toBe(false);
    expect(shouldOpenSyncRecoveryOnLeave("saving")).toBe(false);
    expect(shouldOpenSyncRecoveryOnLeave("offline")).toBe(true);
    expect(shouldOpenSyncRecoveryOnLeave("conflict")).toBe(true);
    expect(shouldOpenSyncRecoveryOnLeave("error")).toBe(true);
  });
});

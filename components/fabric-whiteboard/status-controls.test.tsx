// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FabricAiTrigger,
  FabricSyncNotice,
  FabricSyncStatus,
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
    vi.useRealTimers();
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

  it("keeps normal saved and syncing states out of the toolbar", () => {
    render(<FabricSyncStatus state="saving" onOpenRecovery={() => undefined} />);
    expect(container.innerHTML).toBe("");

    render(<FabricSyncStatus state="synced" onOpenRecovery={() => undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("keeps actionable sync states connected to recovery", () => {
    const onOpenRecovery = vi.fn();
    render(<FabricSyncStatus state="offline" onOpenRecovery={onOpenRecovery} />);

    const recoveryButton = container.querySelector<HTMLButtonElement>("button");
    expect(recoveryButton?.getAttribute("aria-label")).toBe(
      "Offline. Open Save Recovery",
    );
    act(() => recoveryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenRecovery).toHaveBeenCalledOnce();
  });

  it("automatically clears the offline notice while retaining recovery access", () => {
    vi.useFakeTimers();
    const onOpenRecovery = vi.fn();
    render(
      <FabricSyncNotice
        state="offline"
        message="Realtime is temporarily unavailable."
        onOpenRecovery={onOpenRecovery}
      />,
    );

    expect(container.textContent).toContain(
      "Live collaboration is offline. Your work remains on this device while Fabric reconnects.",
    );
    act(() => vi.advanceTimersByTime(6_000));
    expect(container.querySelector('[aria-label="Board Sync Notice"]')).toBeNull();
    expect(onOpenRecovery).not.toHaveBeenCalled();
  });

  it("lets the user dismiss a notice or open recovery immediately", () => {
    vi.useFakeTimers();
    const onOpenRecovery = vi.fn();
    render(
      <FabricSyncNotice
        state="error"
        message="Fabric could not save this board."
        onOpenRecovery={onOpenRecovery}
      />,
    );

    const review = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Review Sync",
    );
    act(() => review?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenRecovery).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="Board Sync Notice"]')).toBeNull();
  });
});

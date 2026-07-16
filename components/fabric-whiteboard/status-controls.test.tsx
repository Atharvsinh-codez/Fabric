// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FabricAssistanceModePicker,
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

  it("exposes clear pressed and panel states for every assistance mode", () => {
    const onModeChange = vi.fn();
    render(
      <FabricAssistanceModePicker
        mode="feedback"
        panelOpen={false}
        busy={false}
        canEdit
        onModeChange={onModeChange}
      />,
    );

    const feedback = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open Feedback Assistance"]',
    );
    const solve = container.querySelector<HTMLButtonElement>(
      '[aria-label="Open Solve Assistance"]',
    );
    expect(feedback?.getAttribute("aria-pressed")).toBe("true");
    expect(feedback?.getAttribute("aria-expanded")).toBe("false");
    expect(solve?.getAttribute("aria-pressed")).toBe("false");

    act(() => feedback?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onModeChange).toHaveBeenCalledWith("feedback");

    act(() => solve?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onModeChange).toHaveBeenCalledWith("solve");
  });

  it("keeps edit-only assistance modes unavailable to viewers", () => {
    render(
      <FabricAssistanceModePicker
        mode="off"
        panelOpen={false}
        busy={false}
        canEdit={false}
        onModeChange={() => undefined}
      />,
    );

    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Turn Off AI Assistance"]',
      )?.disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Open Suggest Assistance"]',
      )?.disabled,
    ).toBe(true);
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

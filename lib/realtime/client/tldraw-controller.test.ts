import { createTLStore } from "tldraw";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TldrawCheckpoint } from "../../boards/tldraw-store-adapter";
import { TldrawCollaborationController } from "./tldraw-controller";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const BOARD_ID = "00000000-0000-4000-8000-000000000002";
const DOCUMENT_GENERATION_ID = "00000000-0000-4000-8000-000000000003";

type SchedulableController = {
  scheduleCheckpoint: (source: "local" | "remote") => void;
};

const controllers: TldrawCollaborationController[] = [];

function createController(
  onCheckpoint: (checkpoint: TldrawCheckpoint) => void,
  checkpointSource: "all" | "local" | "remote" = "all",
) {
  const controller = new TldrawCollaborationController({
    store: createTLStore(),
    principalId: PRINCIPAL_ID,
    boardId: BOARD_ID,
    documentGenerationId: DOCUMENT_GENERATION_ID,
    canEdit: true,
    checkpointDebounceMs: 100,
    checkpointSource,
    onCheckpoint,
  });
  controllers.push(controller);
  return controller;
}

function scheduleCheckpoint(
  controller: TldrawCollaborationController,
  source: "local" | "remote" = "local",
) {
  (controller as unknown as SchedulableController).scheduleCheckpoint(source);
}

function idleDeadline(): IdleDeadline {
  return { didTimeout: false, timeRemaining: () => 10 };
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.destroy()));
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TldrawCollaborationController checkpoint scheduling", () => {
  it("debounces changes before requesting a bounded idle checkpoint", async () => {
    vi.useFakeTimers();
    let idleCallback: IdleRequestCallback | undefined;
    const requestIdleCallback = vi.fn(
      (callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 41;
      },
    );
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const onCheckpoint = vi.fn();
    const controller = createController(onCheckpoint);

    scheduleCheckpoint(controller);
    await vi.advanceTimersByTimeAsync(99);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 500,
    });
    expect(onCheckpoint).not.toHaveBeenCalled();

    idleCallback?.(idleDeadline());

    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect(onCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.any(Array),
        edges: expect.any(Array),
        tldraw: expect.objectContaining({ version: 1 }),
      }),
    );
  });

  it("cancels stale idle work when another eligible change arrives or the controller is destroyed", async () => {
    vi.useFakeTimers();
    const idleCallbacks: IdleRequestCallback[] = [];
    let nextHandle = 51;
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback);
      return nextHandle++;
    });
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const onCheckpoint = vi.fn();
    const controller = createController(onCheckpoint);

    scheduleCheckpoint(controller);
    await vi.advanceTimersByTimeAsync(100);
    expect(idleCallbacks).toHaveLength(1);

    scheduleCheckpoint(controller);
    expect(cancelIdleCallback).toHaveBeenCalledWith(51);
    idleCallbacks[0]?.(idleDeadline());
    expect(onCheckpoint).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(idleCallbacks).toHaveLength(2);
    await controller.destroy();
    expect(cancelIdleCallback).toHaveBeenCalledWith(52);
    idleCallbacks[1]?.(idleDeadline());
    expect(onCheckpoint).not.toHaveBeenCalled();
  });

  it("uses a cancellable timer fallback when the idle callback API is unavailable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
    const onCheckpoint = vi.fn();
    const controller = createController(onCheckpoint);

    scheduleCheckpoint(controller);
    await vi.advanceTimersByTimeAsync(99);
    expect(onCheckpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runOnlyPendingTimersAsync();

    expect(onCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("does not let an ignored source cancel an eligible pending checkpoint", async () => {
    vi.useFakeTimers();
    let idleCallback: IdleRequestCallback | undefined;
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 61;
      }),
    );
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const onCheckpoint = vi.fn();
    const controller = createController(onCheckpoint, "local");

    scheduleCheckpoint(controller, "local");
    await vi.advanceTimersByTimeAsync(100);
    scheduleCheckpoint(controller, "remote");

    expect(cancelIdleCallback).not.toHaveBeenCalled();
    idleCallback?.(idleDeadline());
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  CursorMotionController,
  type CursorMotionScheduler,
  type CursorScreenPoint,
  cursorTransform,
} from "./cursor-motion";

function testScheduler(reducedMotion = false) {
  let now = 0;
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  });
  const cancelFrame = vi.fn((handle: number) => callbacks.delete(handle));
  const scheduler: CursorMotionScheduler = {
    requestFrame,
    cancelFrame,
    now: () => now,
    prefersReducedMotion: () => reducedMotion,
  };

  return {
    scheduler,
    requestFrame,
    cancelFrame,
    pendingFrames: () => callbacks.size,
    advanceFrame(deltaMs = 16) {
      now += deltaMs;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(now);
    },
  };
}

describe("remote cursor motion", () => {
  it("coalesces rapid presence targets into one smooth animation-frame loop", () => {
    const frames = testScheduler();
    const writes: CursorScreenPoint[] = [];
    const controller = new CursorMotionController(frames.scheduler);
    controller.attach(7, { x: 0, y: 0 }, (point) => writes.push(point));

    controller.setTarget(7, { x: 30, y: 15 });
    controller.setTarget(7, { x: 60, y: 30 });
    controller.setTarget(7, { x: 90, y: 45 });

    expect(frames.requestFrame).toHaveBeenCalledTimes(1);
    expect(frames.pendingFrames()).toBe(1);
    frames.advanceFrame();
    expect(writes.at(-1)?.x).toBeGreaterThan(0);
    expect(writes.at(-1)?.x).toBeLessThan(90);

    for (let frame = 0; frame < 40 && frames.pendingFrames(); frame += 1) {
      frames.advanceFrame();
    }
    expect(writes.at(-1)).toEqual({ x: 90, y: 45 });
    expect(frames.pendingFrames()).toBe(0);
  });

  it("snaps projection changes so a local camera move cannot detach the cursor", () => {
    const frames = testScheduler();
    const writes: CursorScreenPoint[] = [];
    const controller = new CursorMotionController(frames.scheduler);
    controller.attach(8, { x: 10, y: 20 }, (point) => writes.push(point));
    controller.setTarget(8, { x: 100, y: 200 });
    frames.advanceFrame();
    expect(writes.at(-1)).not.toEqual({ x: 100, y: 200 });

    controller.setTarget(8, { x: 240, y: 320 }, { snap: true });

    expect(writes.at(-1)).toEqual({ x: 240, y: 320 });
    frames.advanceFrame();
    expect(writes.at(-1)).toEqual({ x: 240, y: 320 });
    expect(frames.pendingFrames()).toBe(0);
  });

  it("honors reduced motion and cancels an orphaned frame", () => {
    const frames = testScheduler(true);
    const write = vi.fn();
    const controller = new CursorMotionController(frames.scheduler);
    controller.attach(9, { x: 0, y: 0 }, write);
    controller.setTarget(9, { x: 100, y: 50 });
    expect(write).toHaveBeenLastCalledWith({ x: 100, y: 50 });
    expect(frames.pendingFrames()).toBe(0);

    const animatedFrames = testScheduler();
    const animated = new CursorMotionController(animatedFrames.scheduler);
    animated.attach(10, { x: 0, y: 0 }, vi.fn());
    animated.setTarget(10, { x: 100, y: 50 });
    animated.detach(10);
    expect(animatedFrames.cancelFrame).toHaveBeenCalledOnce();
    expect(animatedFrames.pendingFrames()).toBe(0);
  });

  it("formats GPU-backed cursor transforms without rounding coordinates", () => {
    expect(cursorTransform({ x: 12.25, y: -4.5 })).toBe(
      "translate3d(12.25px, -4.5px, 0)",
    );
  });
});

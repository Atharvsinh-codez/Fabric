export type CursorScreenPoint = Readonly<{ x: number; y: number }>;

type CursorPositionWriter = (position: CursorScreenPoint) => void;

export type CursorMotionScheduler = Readonly<{
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
  prefersReducedMotion?: () => boolean;
}>;

type CursorMotionState = {
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  lastFrameAt: number;
  settled: boolean;
  write: CursorPositionWriter;
};

const SMOOTHING_TIME_CONSTANT_MS = 48;
const MAX_FRAME_DELTA_MS = 50;
const SETTLE_DISTANCE_PX = 0.25;
const TELEPORT_DISTANCE_PX = 1_500;

function squaredDistance(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const x = toX - fromX;
  const y = toY - fromY;
  return x * x + y * y;
}

/**
 * Smooths all remote cursors through one animation-frame loop. Presence
 * samples remain network-throttled; this controller only fills the visual
 * gaps between already-received samples.
 */
export class CursorMotionController {
  private readonly cursors = new Map<number, CursorMotionState>();
  private frameHandle: number | null = null;

  constructor(private readonly scheduler: CursorMotionScheduler) {}

  attach(
    clientId: number,
    initialPosition: CursorScreenPoint,
    write: CursorPositionWriter,
  ): void {
    const existing = this.cursors.get(clientId);
    if (existing) {
      existing.write = write;
      write({ x: existing.currentX, y: existing.currentY });
      return;
    }

    this.cursors.set(clientId, {
      currentX: initialPosition.x,
      currentY: initialPosition.y,
      targetX: initialPosition.x,
      targetY: initialPosition.y,
      lastFrameAt: this.scheduler.now(),
      settled: true,
      write,
    });
    write(initialPosition);
  }

  detach(clientId: number): void {
    this.cursors.delete(clientId);
    if (this.cursors.size === 0 && this.frameHandle !== null) {
      this.scheduler.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  setTarget(
    clientId: number,
    target: CursorScreenPoint,
    options: Readonly<{ snap?: boolean }> = {},
  ): void {
    const cursor = this.cursors.get(clientId);
    if (!cursor) return;

    const targetUnchanged =
      cursor.targetX === target.x && cursor.targetY === target.y;
    if (targetUnchanged) return;

    const teleport =
      squaredDistance(
        cursor.currentX,
        cursor.currentY,
        target.x,
        target.y,
      ) >= TELEPORT_DISTANCE_PX * TELEPORT_DISTANCE_PX;
    const snap =
      options.snap === true ||
      teleport ||
      this.scheduler.prefersReducedMotion?.() === true;

    cursor.targetX = target.x;
    cursor.targetY = target.y;
    cursor.lastFrameAt = this.scheduler.now();

    if (snap) {
      cursor.currentX = target.x;
      cursor.currentY = target.y;
      cursor.settled = true;
      cursor.write(target);
      return;
    }

    cursor.settled = false;
    this.requestFrame();
  }

  destroy(): void {
    if (this.frameHandle !== null) {
      this.scheduler.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.cursors.clear();
  }

  private requestFrame(): void {
    if (this.frameHandle !== null) return;
    this.frameHandle = this.scheduler.requestFrame(this.advanceFrame);
  }

  private readonly advanceFrame: FrameRequestCallback = (timestamp) => {
    this.frameHandle = null;
    let hasMovingCursor = false;

    for (const cursor of this.cursors.values()) {
      if (cursor.settled) continue;

      const elapsed = Math.max(
        0,
        Math.min(MAX_FRAME_DELTA_MS, timestamp - cursor.lastFrameAt),
      );
      cursor.lastFrameAt = timestamp;
      const blend = 1 - Math.exp(-elapsed / SMOOTHING_TIME_CONSTANT_MS);
      cursor.currentX += (cursor.targetX - cursor.currentX) * blend;
      cursor.currentY += (cursor.targetY - cursor.currentY) * blend;

      const remaining = squaredDistance(
        cursor.currentX,
        cursor.currentY,
        cursor.targetX,
        cursor.targetY,
      );
      if (remaining <= SETTLE_DISTANCE_PX * SETTLE_DISTANCE_PX) {
        cursor.currentX = cursor.targetX;
        cursor.currentY = cursor.targetY;
        cursor.settled = true;
      } else {
        hasMovingCursor = true;
      }

      cursor.write({ x: cursor.currentX, y: cursor.currentY });
    }

    if (hasMovingCursor) this.requestFrame();
  };
}

export function cursorTransform(position: CursorScreenPoint): string {
  return `translate3d(${position.x}px, ${position.y}px, 0)`;
}

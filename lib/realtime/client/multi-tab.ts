import { z } from "zod";

import {
  REALTIME_CAPABILITIES,
  REALTIME_LIMITS,
  REALTIME_PROTOCOL_VERSION,
  type RealtimeCapability,
} from "../constants";
import type { RealtimeConnectionState, RealtimeScope } from "./types";

const uuid = z.string().uuid();
const payloadHash = z.string().regex(/^[0-9a-f]{64}$/);
const encodedUpdate = z
  .string()
  .min(4)
  .max(Math.ceil((REALTIME_LIMITS.maximumUpdateBytes * 4) / 3) + 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const encodedAwareness = z
  .string()
  .min(4)
  .max(Math.ceil((REALTIME_LIMITS.awarenessBytes * 4) / 3) + 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const connectionState = z.enum([
  "idle",
  "ticketing",
  "connecting",
  "authenticating",
  "syncing",
  "connected",
  "reconnecting",
  "offline",
  "permission-denied",
  "stopped",
  "error",
]);
const baseMessage = {
  protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
  scopeKey: z.string().min(1).max(256),
  senderId: uuid,
};

const realtimeTabMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...baseMessage, type: z.literal("state.request") }).strict(),
  z
    .object({
      ...baseMessage,
      type: z.literal("owner.state"),
      state: connectionState,
      capabilities: z.array(z.enum(REALTIME_CAPABILITIES)).max(3),
      committedSequence: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...baseMessage,
      type: z.literal("document.snapshot"),
      committedSequence: z.number().int().nonnegative(),
      payloadHash,
      update: encodedUpdate,
    })
    .strict(),
  z
    .object({
      ...baseMessage,
      type: z.literal("document.local"),
      messageId: uuid,
      payloadHash,
      update: encodedUpdate,
    })
    .strict(),
  z
    .object({
      ...baseMessage,
      type: z.literal("document.remote"),
      messageId: uuid,
      sequence: z.number().int().positive(),
      payloadHash,
      update: encodedUpdate,
    })
    .strict(),
  z
    .object({
      ...baseMessage,
      type: z.literal("sync.ack"),
      messageId: uuid,
      sequence: z.number().int().positive(),
      payloadHash,
    })
    .strict(),
  z
    .object({
      ...baseMessage,
      type: z.literal("awareness.remote"),
      update: encodedAwareness,
    })
    .strict(),
]);

export type RealtimeTabMessage = z.infer<typeof realtimeTabMessageSchema>;

export type RealtimeTabPayload =
  | Readonly<{ type: "state.request" }>
  | Readonly<{
      type: "owner.state";
      state: RealtimeConnectionState;
      capabilities: RealtimeCapability[];
      committedSequence: number;
    }>
  | Readonly<{
      type: "document.snapshot";
      committedSequence: number;
      payloadHash: string;
      update: string;
    }>
  | Readonly<{
      type: "document.local";
      messageId: string;
      payloadHash: string;
      update: string;
    }>
  | Readonly<{
      type: "document.remote";
      messageId: string;
      sequence: number;
      payloadHash: string;
      update: string;
    }>
  | Readonly<{
      type: "sync.ack";
      messageId: string;
      sequence: number;
      payloadHash: string;
    }>
  | Readonly<{ type: "awareness.remote"; update: string }>;

export interface RealtimeTabChannel {
  postMessage(message: unknown): void;
  close(): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
}

export interface RealtimeTabLockManager {
  request(
    name: string,
    options: Readonly<{ signal: AbortSignal }>,
    callback: () => Promise<void>,
  ): Promise<void>;
}

export type RealtimeMultiTabConfiguration = Readonly<{
  enabled?: boolean;
  lockManager?: RealtimeTabLockManager | null;
  channelFactory?: ((name: string) => RealtimeTabChannel) | null;
}>;

type RealtimeTabDependencies = Readonly<{
  lockManager: RealtimeTabLockManager;
  channelFactory: (name: string) => RealtimeTabChannel;
}>;

function nativeDependencies(): RealtimeTabDependencies | null {
  if (
    typeof navigator === "undefined" ||
    !navigator.locks ||
    typeof BroadcastChannel === "undefined"
  ) {
    return null;
  }
  const nativeLocks = navigator.locks;
  return {
    lockManager: {
      request: (name, options, callback) =>
        nativeLocks
          .request(
            name,
            { mode: "exclusive", signal: options.signal },
            async (lock) => {
              if (!lock) {
                throw new Error("The realtime ownership lock was unavailable.");
              }
              await callback();
            },
          )
          .then(() => undefined),
    },
    channelFactory: (name) => new BroadcastChannel(name),
  };
}

function configuredDependencies(
  configuration: RealtimeMultiTabConfiguration | undefined,
): RealtimeTabDependencies | null {
  if (configuration?.enabled === false) return null;
  const native = nativeDependencies();
  const lockManager =
    configuration?.lockManager === null
      ? null
      : (configuration?.lockManager ?? native?.lockManager);
  const channelFactory =
    configuration?.channelFactory === null
      ? null
      : (configuration?.channelFactory ?? native?.channelFactory);
  return lockManager && channelFactory ? { lockManager, channelFactory } : null;
}

export function realtimeTabScopeKey(scope: RealtimeScope): string {
  return `${scope.principalId}:${scope.boardId}:${scope.documentGenerationId}`;
}

export class RealtimeTabCoordinator {
  private readonly abortController = new AbortController();
  private readonly channel: RealtimeTabChannel;
  private readonly scopeKey: string;
  private readonly senderId: string;
  private readonly dependencies: RealtimeTabDependencies;
  private readonly onMessage: (message: RealtimeTabMessage) => void;
  private readonly onOwnerChange: (owner: boolean) => void;
  private readonly onFailure: () => void;
  private releaseOwnership: (() => void) | undefined;
  private ownershipTask: Promise<void> | undefined;
  private destroyed = false;
  private owner = false;

  static create(input: {
    scope: RealtimeScope;
    senderId: string;
    configuration?: RealtimeMultiTabConfiguration;
    onMessage: (message: RealtimeTabMessage) => void;
    onOwnerChange: (owner: boolean) => void;
    onFailure: () => void;
  }): RealtimeTabCoordinator | null {
    const dependencies = configuredDependencies(input.configuration);
    return dependencies
      ? new RealtimeTabCoordinator(input, dependencies)
      : null;
  }

  private constructor(
    input: {
      scope: RealtimeScope;
      senderId: string;
      onMessage: (message: RealtimeTabMessage) => void;
      onOwnerChange: (owner: boolean) => void;
      onFailure: () => void;
    },
    dependencies: RealtimeTabDependencies,
  ) {
    this.scopeKey = realtimeTabScopeKey(input.scope);
    this.senderId = input.senderId;
    this.dependencies = dependencies;
    this.onMessage = input.onMessage;
    this.onOwnerChange = input.onOwnerChange;
    this.onFailure = input.onFailure;
    this.channel = dependencies.channelFactory(
      `fabric-realtime-v1:channel:${this.scopeKey}`,
    );
  }

  get isOwner(): boolean {
    return this.owner;
  }

  start(): void {
    if (this.destroyed || this.ownershipTask) return;
    this.channel.addEventListener("message", this.handleMessage);
    this.post({ type: "state.request" });
    this.ownershipTask = this.dependencies.lockManager
      .request(
        `fabric-realtime-v1:owner:${this.scopeKey}`,
        { signal: this.abortController.signal },
        async () => {
          if (this.destroyed) return;
          this.owner = true;
          this.onOwnerChange(true);
          await new Promise<void>((resolve) => {
            this.releaseOwnership = resolve;
          });
          this.releaseOwnership = undefined;
          this.owner = false;
          this.onOwnerChange(false);
        },
      )
      .catch((error: unknown) => {
        if (!this.destroyed && !this.abortController.signal.aborted) {
          this.onFailure();
        }
        if (error instanceof Error && error.name === "AbortError") return;
      });
  }

  post(payload: RealtimeTabPayload): void {
    if (this.destroyed) return;
    const message = realtimeTabMessageSchema.parse({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      scopeKey: this.scopeKey,
      senderId: this.senderId,
      ...payload,
    });
    this.channel.postMessage(message);
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();
    this.releaseOwnership?.();
    await this.ownershipTask?.catch(() => undefined);
    this.channel.removeEventListener("message", this.handleMessage);
    this.channel.close();
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (this.destroyed) return;
    const parsed = realtimeTabMessageSchema.safeParse(event.data);
    if (
      !parsed.success ||
      parsed.data.scopeKey !== this.scopeKey ||
      parsed.data.senderId === this.senderId
    ) {
      return;
    }
    this.onMessage(parsed.data);
  };
}

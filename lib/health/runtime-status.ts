export type FabricRuntimeStatus = Readonly<{
  web: boolean;
  realtime: boolean;
  aiWorker: boolean;
  acceptingAiRuns: boolean;
  shuttingDown: boolean;
}>;

const RUNTIME_STATUS_KEY = Symbol.for("fabric.runtime.status");

type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_STATUS_KEY]?: FabricRuntimeStatus;
};

const defaultStatus: FabricRuntimeStatus = Object.freeze({
  web: false,
  realtime: false,
  aiWorker: false,
  acceptingAiRuns: false,
  shuttingDown: false,
});

export function getFabricRuntimeStatus(): FabricRuntimeStatus {
  return (globalThis as RuntimeGlobal)[RUNTIME_STATUS_KEY] ?? defaultStatus;
}

export function setFabricRuntimeStatus(status: FabricRuntimeStatus): void {
  (globalThis as RuntimeGlobal)[RUNTIME_STATUS_KEY] = Object.freeze({ ...status });
}

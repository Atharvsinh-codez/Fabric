import { startAiWorkerRuntime } from "./runtime";

void startAiWorkerRuntime()
  .then((runtime) => {
    console.info("Fabric AI worker background loop started.");
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        void runtime.stop(signal).finally(() => process.exit(0));
      });
    }
  })
  .catch((error) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error(`Fabric AI worker startup failed: ${errorName}.`);
    process.exitCode = 1;
  });

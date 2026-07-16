if (process.env.NODE_ENV === undefined) {
  Reflect.set(
    process.env,
    "NODE_ENV",
    process.env.npm_lifecycle_event === "dev" ? "development" : "production",
  );
}

const RUNTIME_PROBE_INTERVAL_MS = 15_000;
const FORCE_CLOSE_HTTP_AFTER_MS = 50_000;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function startFabricServer(): Promise<void> {
  const { createServer } = await import("node:http");
  const { default: next } = await import("next");
  const { loadFabricServerConfig } = await import("./lib/server/config");
  const { setFabricRuntimeStatus } = await import("./lib/health/runtime-status");
  const { createFabricRealtimeRuntime } = await import("./realtime/server");
  const { startAiWorkerRuntime } = await import("./worker/runtime");

  const config = loadFabricServerConfig();
  const nextApp = next({
    dev: config.development,
    dir: process.cwd(),
    hostname: config.hostname,
    port: config.port,
  });
  let aiWorkerRuntime: Awaited<ReturnType<typeof startAiWorkerRuntime>> | null = null;
  let detachRealtime: (() => void) | null = null;
  let runtimeProbe: ReturnType<typeof setInterval> | null = null;
  let runtimeProbeRunning = false;
  let shutdownPromise: Promise<void> | null = null;

  setFabricRuntimeStatus({
    web: false,
    realtime: false,
    aiWorker: false,
    acceptingAiRuns: false,
    shuttingDown: false,
  });

  try {
    await nextApp.prepare();
  } catch (error) {
    await nextApp.close().catch(() => undefined);
    throw error;
  }
  const realtimeRuntime = createFabricRealtimeRuntime();
  const requestHandler = nextApp.getRequestHandler();
  const nextUpgradeHandler = nextApp.getUpgradeHandler();
  const httpServer = createServer((request, response) => {
    void requestHandler(request, response).catch((error: unknown) => {
      console.error(`Fabric web request failed: ${errorName(error)}.`);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Cache-Control", "no-store");
      }
      if (!response.writableEnded) response.end("Internal Server Error");
    });
  });

  const closeHttpServer = (): Promise<void> => {
    if (!httpServer.listening) return Promise.resolve();
    return new Promise((resolve) => {
      const forceCloseTimer = setTimeout(() => {
        httpServer.closeAllConnections();
      }, FORCE_CLOSE_HTTP_AFTER_MS);
      forceCloseTimer.unref();
      httpServer.close(() => {
        clearTimeout(forceCloseTimer);
        resolve();
      });
      httpServer.closeIdleConnections();
    });
  };

  const probe = async (check: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await check();
    } catch {
      return false;
    }
  };

  const refreshRuntimeStatus = async (): Promise<void> => {
    if (runtimeProbeRunning || shutdownPromise || !aiWorkerRuntime) return;
    runtimeProbeRunning = true;
    try {
      const [realtimeReady, aiWorkerReady] = await Promise.all([
        probe(realtimeRuntime.ready),
        probe(aiWorkerRuntime.ready),
      ]);
      if (shutdownPromise) return;
      setFabricRuntimeStatus({
        web: httpServer.listening,
        realtime: realtimeReady,
        aiWorker: aiWorkerReady,
        acceptingAiRuns: aiWorkerReady && aiWorkerRuntime.acceptingRuns,
        shuttingDown: false,
      });
    } finally {
      runtimeProbeRunning = false;
    }
  };

  const shutdown = (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    setFabricRuntimeStatus({
      web: false,
      realtime: false,
      aiWorker: false,
      acceptingAiRuns: false,
      shuttingDown: true,
    });
    if (runtimeProbe) clearInterval(runtimeProbe);
    runtimeProbe = null;
    detachRealtime?.();
    detachRealtime = null;

    shutdownPromise = (async () => {
      console.info(`Fabric received ${signal}; shutting down single-origin runtimes.`);
      const runtimeResults = await Promise.allSettled([
        closeHttpServer(),
        realtimeRuntime.stop(),
        aiWorkerRuntime?.stop(signal),
      ]);
      const nextResult = await Promise.allSettled([nextApp.close()]);
      const failures = [...runtimeResults, ...nextResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, "One or more Fabric runtimes failed to stop.");
      }
      console.info("Fabric single-origin server stopped.");
    })();
    return shutdownPromise;
  };

  try {
    aiWorkerRuntime = await startAiWorkerRuntime();
    await realtimeRuntime.start();

    const [realtimeReady, aiWorkerReady] = await Promise.all([
      probe(realtimeRuntime.ready),
      probe(aiWorkerRuntime.ready),
    ]);
    if (!realtimeReady || !aiWorkerReady) {
      throw new Error("A Fabric runtime failed its startup readiness probe.");
    }

    detachRealtime = realtimeRuntime.attach(httpServer, (request, socket, head) => {
      void (async () => nextUpgradeHandler(request, socket, head))().catch(
        (error: unknown) => {
          console.error(`Fabric Next.js upgrade failed: ${errorName(error)}.`);
          socket.destroy();
        },
      );
    });

    const onRuntimeServerError = (error: Error): void => {
      console.error(`Fabric HTTP server failed: ${errorName(error)}.`);
      void shutdown("http_server_error").catch((shutdownError: unknown) => {
        console.error(`Fabric shutdown failed: ${errorName(shutdownError)}.`);
        process.exitCode = 1;
      });
    };

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      httpServer.once("error", onError);
      httpServer.listen(config.port, config.hostname, () => {
        httpServer.off("error", onError);
        httpServer.on("error", onRuntimeServerError);
        resolve();
      });
    });

    setFabricRuntimeStatus({
      web: true,
      realtime: true,
      aiWorker: true,
      acceptingAiRuns: aiWorkerRuntime.acceptingRuns,
      shuttingDown: false,
    });
    runtimeProbe = setInterval(() => {
      void refreshRuntimeStatus();
    }, RUNTIME_PROBE_INTERVAL_MS);
    runtimeProbe.unref();

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void shutdown(signal).catch((error: unknown) => {
          console.error(`Fabric shutdown failed: ${errorName(error)}.`);
          process.exitCode = 1;
        });
      });
    }

    console.info(
      `Fabric single-origin ${config.development ? "development" : "production"} server listening on ${config.hostname}:${config.port}.`,
    );
  } catch (error) {
    await shutdown("startup_failure").catch(() => undefined);
    throw error;
  }
}

void startFabricServer().catch((error: unknown) => {
  console.error(`Fabric single-origin startup failed: ${errorName(error)}.`);
  process.exitCode = 1;
});

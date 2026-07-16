import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.toml",
        environment: "dev",
      },
      miniflare: {
        bindings: {
          REALTIME_TICKET_SIGNING_KEY:
            "fabric-realtime-worker-test-signing-key-32-bytes",
          REALTIME_COORDINATOR_SECRET:
            "fabric-realtime-coordinator-test-secret-32-bytes",
        },
      },
    }),
  ],
  test: {
    include: ["cloudflare/realtime/worker.runtime.ts"],
  },
});

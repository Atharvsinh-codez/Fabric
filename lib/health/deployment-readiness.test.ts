import { describe, expect, it, vi } from "vitest";

import {
  deriveExternalRealtimeHealthUrl,
  getFabricReadinessTopology,
  getReadyWorkspaceRolloutMode,
  hasReadyPrivateMediaConfiguration,
  hasReadyRealtimeRevocationConfiguration,
  hasReadyServerlessAiConfiguration,
  probeExternalRealtime,
} from "./deployment-readiness";

const workerEnvironment = {
  VERCEL: "1",
  WORKER_DATABASE_URL:
    "postgresql://worker:secret@worker-pooler.example.test/fabric?sslmode=require",
  DATABASE_URL:
    "postgresql://web:secret@web-pooler.example.test/fabric?sslmode=require",
  GEMINI_API_KEYS:
    "production-primary-api-key-value-long-enough,production-secondary-api-key-value-long-enough",
  GEMINI_MODEL: "gemini-2.5-flash",
  GEMINI_STORE_INTERACTIONS: "false",
  AI_RUNS_ENABLED: "true",
  NEXT_PUBLIC_REALTIME_URL:
    "wss://fabric-realtime.example.workers.dev/realtime",
  REALTIME_REVOCATION_ENDPOINT:
    "https://fabric-realtime.example.workers.dev/internal/revocations",
  REALTIME_COORDINATOR_SECRET: "c".repeat(48),
  REALTIME_REVOCATION_DISPATCH_SECRET: "d".repeat(48),
  REALTIME_TICKET_SIGNING_KEY: "t".repeat(48),
  HEALTHCHECK_SECRET: "h".repeat(48),
};

describe("deployment readiness topology", () => {
  it("uses external service checks only on Vercel", () => {
    expect(getFabricReadinessTopology({ VERCEL: "1" })).toBe(
      "vercel-serverless",
    );
    expect(getFabricReadinessTopology({ VERCEL: "0" })).toBe("attached");
    expect(getFabricReadinessTopology({})).toBe("attached");
  });

  it("derives only a public HTTPS health target from the configured WSS base", () => {
    expect(
      deriveExternalRealtimeHealthUrl(
        "wss://fabric-realtime.example.workers.dev/realtime",
      )?.toString(),
    ).toBe("https://fabric-realtime.example.workers.dev/health");

    for (const invalid of [
      "ws://fabric-realtime.example/realtime",
      "wss://127.0.0.1/realtime",
      "wss://localhost/realtime",
      "wss://fabric-realtime.example/other",
      "wss://fabric-realtime.example/realtime?token=secret",
      "wss://user:password@fabric-realtime.example/realtime",
    ]) {
      expect(deriveExternalRealtimeHealthUrl(invalid)).toBeNull();
    }
  });

  it("accepts only the bounded Cloudflare Durable Object health contract", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (target, init) => {
      expect(target.toString()).toBe(
        "https://fabric-realtime.example.workers.dev/health",
      );
      expect(init).toMatchObject({
        method: "GET",
        cache: "no-store",
        redirect: "error",
      });
      return Response.json({
        status: "ok",
        transport: "cloudflare-durable-objects",
      });
    });

    await expect(
      probeExternalRealtime({
        configuredRealtimeUrl:
          "wss://fabric-realtime.example.workers.dev/realtime",
        fetchImplementation,
      }),
    ).resolves.toBe(true);
    expect(fetchImplementation).toHaveBeenCalledOnce();

    await expect(
      probeExternalRealtime({
        configuredRealtimeUrl:
          "wss://fabric-realtime.example.workers.dev/realtime",
        fetchImplementation: vi.fn<typeof fetch>(async () =>
          Response.json({ status: "ok", transport: "unexpected" }),
        ),
      }),
    ).resolves.toBe(false);
  });

  it("validates the same bounded AI configuration used by serverless dispatch", () => {
    expect(hasReadyServerlessAiConfiguration(workerEnvironment)).toBe(true);
    expect(
      hasReadyServerlessAiConfiguration({
        ...workerEnvironment,
        WORKER_DATABASE_URL: undefined,
      }),
    ).toBe(true);
    expect(
      hasReadyServerlessAiConfiguration({
        ...workerEnvironment,
        WORKER_DATABASE_URL: undefined,
        DATABASE_URL: undefined,
      }),
    ).toBe(false);
    expect(
      hasReadyServerlessAiConfiguration({
        ...workerEnvironment,
        AI_RUNS_ENABLED: "false",
      }),
    ).toBe(false);
    expect(
      hasReadyServerlessAiConfiguration({
        ...workerEnvironment,
        WORKER_DATABASE_URL: workerEnvironment.DATABASE_URL,
      }),
    ).toBe(false);
    expect(
      hasReadyServerlessAiConfiguration({
        ...workerEnvironment,
        GEMINI_API_KEYS: "replace-me",
      }),
    ).toBe(false);
  });

  it("requires a same-Worker, purpose-separated revocation dispatcher", () => {
    expect(hasReadyRealtimeRevocationConfiguration(workerEnvironment)).toBe(true);
    expect(
      hasReadyRealtimeRevocationConfiguration({
        ...workerEnvironment,
        REALTIME_REVOCATION_ENDPOINT:
          "https://other-worker.example.workers.dev/internal/revocations",
      }),
    ).toBe(false);
    expect(
      hasReadyRealtimeRevocationConfiguration({
        ...workerEnvironment,
        REALTIME_COORDINATOR_SECRET:
          workerEnvironment.REALTIME_TICKET_SIGNING_KEY,
      }),
    ).toBe(false);
    expect(
      hasReadyRealtimeRevocationConfiguration({
        ...workerEnvironment,
        REALTIME_REVOCATION_DISPATCH_SECRET: "replace-me",
      }),
    ).toBe(false);
  });

  it("requires complete private R2 and cleanup configuration", () => {
    const mediaEnvironment = {
      FABRIC_R2_ACCOUNT_ID: "a".repeat(32),
      FABRIC_R2_ACCESS_KEY_ID: "media-access-key-id",
      FABRIC_R2_SECRET_ACCESS_KEY: "s".repeat(64),
      FABRIC_R2_BOARD_ASSET_BUCKET: "fabric-board-assets",
      FABRIC_R2_AVATAR_BUCKET: "fabric-avatars",
      FABRIC_R2_PRESIGN_TTL_SECONDS: "300",
      MEDIA_CLEANUP_SECRET: "m".repeat(48),
    };
    expect(hasReadyPrivateMediaConfiguration(mediaEnvironment)).toBe(true);
    expect(
      hasReadyPrivateMediaConfiguration({
        ...mediaEnvironment,
        MEDIA_CLEANUP_SECRET: "replace-me",
      }),
    ).toBe(false);
    expect(
      hasReadyPrivateMediaConfiguration({
        ...mediaEnvironment,
        FABRIC_R2_ACCOUNT_ID: undefined,
      }),
    ).toBe(false);
  });

  it("accepts safe rollout modes without exposing the canary allowlist", () => {
    expect(
      getReadyWorkspaceRolloutMode({ FABRIC_ENV: "production" }),
    ).toBe("off");
    expect(
      getReadyWorkspaceRolloutMode({
        FABRIC_ENV: "production",
        FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
        FABRIC_WORKSPACE_CANARY_IDS:
          "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("canary");
    expect(
      getReadyWorkspaceRolloutMode({
        FABRIC_ENV: "production",
        FABRIC_WORKSPACE_ROLLOUT_MODE: "all",
      }),
    ).toBe("all");
  });

  it("fails readiness for malformed rollout configuration", () => {
    expect(
      getReadyWorkspaceRolloutMode({
        FABRIC_ENV: "production",
        FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
        FABRIC_WORKSPACE_CANARY_IDS: "not-a-workspace-id",
      }),
    ).toBeNull();
    expect(
      getReadyWorkspaceRolloutMode({
        FABRIC_ENV: "production",
        FABRIC_WORKSPACE_ROLLOUT_MODE: "gradual",
      }),
    ).toBeNull();
  });
});

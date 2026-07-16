import { after } from "next/server";

/**
 * Best-effort low-latency kick. The transactional outbox and protected cron
 * route remain authoritative if this serverless after-task cannot run.
 */
export function scheduleRealtimeRevocationDispatch(): void {
  try {
    after(async () => {
      try {
        const { runRealtimeRevocationDispatch } = await import(
          "@/lib/realtime/revocation-dispatcher"
        );
        await runRealtimeRevocationDispatch();
      } catch {
        console.error("[realtime-revocations] Post-response dispatch failed; cron will retry.");
      }
    });
  } catch {
    // Direct unit invocation can lack a Next request lifecycle. The outbox is
    // still durable and the protected scheduled dispatcher remains the fallback.
  }
}

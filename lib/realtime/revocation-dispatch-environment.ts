import { z } from "zod";

const schema = z.object({
  FABRIC_ENV: z.enum(["local", "preview", "staging", "production"]).default("local"),
  REALTIME_REVOCATION_ENDPOINT: z.string().url(),
  REALTIME_COORDINATOR_SECRET: z.string().min(32),
  REALTIME_REVOCATION_DISPATCH_SECRET: z.string().min(32),
});

export type RealtimeRevocationDispatchEnvironment = Readonly<{
  endpoint: string;
  coordinatorSecret: string;
  dispatchSecret: string;
}>;

export function getRealtimeRevocationDispatchEnvironment(
  source: Record<string, string | undefined> = process.env,
): RealtimeRevocationDispatchEnvironment {
  const environment = schema.parse(source);
  const endpoint = new URL(environment.REALTIME_REVOCATION_ENDPOINT);
  if (
    endpoint.pathname !== "/internal/revocations" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (environment.FABRIC_ENV === "production" && endpoint.protocol !== "https:")
  ) {
    throw new Error("Production realtime revocation delivery must use HTTPS.");
  }
  if (
    environment.REALTIME_COORDINATOR_SECRET ===
    environment.REALTIME_REVOCATION_DISPATCH_SECRET
  ) {
    throw new Error("Realtime coordinator and dispatch secrets must be purpose-separated.");
  }
  return {
    endpoint: endpoint.toString(),
    coordinatorSecret: environment.REALTIME_COORDINATOR_SECRET,
    dispatchSecret: environment.REALTIME_REVOCATION_DISPATCH_SECRET,
  };
}

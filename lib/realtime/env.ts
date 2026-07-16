import { z } from "zod";

import { parseAllowedOrigins } from "./origin";

const commonSchema = z.object({
  FABRIC_ENV: z
    .enum(["local", "preview", "staging", "production"])
    .default("local"),
  APP_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  REALTIME_ALLOWED_ORIGINS: z.string().optional(),
  REALTIME_TICKET_SIGNING_KEY: z.string().min(32),
  REALTIME_ISSUER: z.string().min(3).max(120).default("fabric-web"),
  REALTIME_AUDIENCE: z.string().min(3).max(120).default("fabric-realtime"),
});

const runtimeSchema = commonSchema.extend({
  REALTIME_DATABASE_URL: z.string().min(1),
  REALTIME_TICKET_REDEMPTION_KEY: z.string().min(32),
});

export type RealtimeIssuerEnvironment = {
  signingKey: string;
  issuer: string;
  audience: string;
  allowedOrigins: ReadonlySet<string>;
};

export type RealtimeRuntimeEnvironment = RealtimeIssuerEnvironment & {
  databaseUrl: string;
  redemptionKey: string;
};

function allowedOriginValue(environment: z.infer<typeof commonSchema>): string {
  const value =
    environment.REALTIME_ALLOWED_ORIGINS ??
    environment.APP_URL ??
    environment.NEXT_PUBLIC_APP_URL;
  if (!value) {
    throw new Error(
      "REALTIME_ALLOWED_ORIGINS, APP_URL, or NEXT_PUBLIC_APP_URL is required.",
    );
  }
  return value;
}

function assertProductionOrigins(
  fabricEnvironment: z.infer<typeof commonSchema>["FABRIC_ENV"],
  allowedOrigins: ReadonlySet<string>,
): void {
  if (fabricEnvironment !== "production") return;
  for (const origin of allowedOrigins) {
    if (!origin.startsWith("https://")) {
      throw new Error("Production realtime origins must use HTTPS.");
    }
  }
}

export function getRealtimeIssuerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): RealtimeIssuerEnvironment {
  const environment = commonSchema.parse(source);
  const allowedOrigins = parseAllowedOrigins(allowedOriginValue(environment));
  assertProductionOrigins(environment.FABRIC_ENV, allowedOrigins);
  return {
    signingKey: environment.REALTIME_TICKET_SIGNING_KEY,
    issuer: environment.REALTIME_ISSUER,
    audience: environment.REALTIME_AUDIENCE,
    allowedOrigins,
  };
}

export function getRealtimeRuntimeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): RealtimeRuntimeEnvironment {
  const environment = runtimeSchema.parse(source);
  if (
    environment.REALTIME_TICKET_SIGNING_KEY ===
    environment.REALTIME_TICKET_REDEMPTION_KEY
  ) {
    throw new Error(
      "Realtime signing and redemption keys must be purpose-separated.",
    );
  }
  const allowedOrigins = parseAllowedOrigins(allowedOriginValue(environment));
  assertProductionOrigins(environment.FABRIC_ENV, allowedOrigins);
  return {
    databaseUrl: environment.REALTIME_DATABASE_URL,
    signingKey: environment.REALTIME_TICKET_SIGNING_KEY,
    redemptionKey: environment.REALTIME_TICKET_REDEMPTION_KEY,
    issuer: environment.REALTIME_ISSUER,
    audience: environment.REALTIME_AUDIENCE,
    allowedOrigins,
  };
}

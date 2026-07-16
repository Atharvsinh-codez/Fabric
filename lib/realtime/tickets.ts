import { randomUUID } from "node:crypto";

import { errors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import {
  REALTIME_CAPABILITIES,
  REALTIME_LIMITS,
  REALTIME_PROTOCOL_VERSION,
  type RealtimeCapability,
} from "./constants";
import { sanitizePresenceDisplayLabel } from "./presence-identity";

const ticketClaimsSchema = z
  .object({
    sub: z.string().uuid(),
    workspaceId: z.string().uuid(),
    boardId: z.string().uuid(),
    documentGenerationId: z.string().uuid(),
    displayLabel: z.string().trim().min(1).max(128).optional(),
    capabilities: z.array(z.enum(REALTIME_CAPABILITIES)).min(1).max(3),
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    jti: z.string().uuid(),
    authorizationIssuedAtMs: z.number().int().nonnegative().optional(),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    iss: z.string().min(1),
    aud: z.string().min(1),
  })
  .strict();

export type RealtimeTicketClaims = z.infer<typeof ticketClaimsSchema>;

export class RealtimeTicketError extends Error {
  constructor(readonly code: "expired" | "invalid") {
    super("The realtime ticket is not valid.");
    this.name = "RealtimeTicketError";
  }
}

type TicketCryptoConfiguration = {
  key: string;
  issuer: string;
  audience: string;
};

export async function mintRealtimeTicket(
  input: {
    subject: string;
    workspaceId: string;
    boardId: string;
    documentGenerationId: string;
    displayLabel?: string | null;
    capabilities: RealtimeCapability[];
    jti?: string;
    now?: Date;
    lifetimeSeconds?: number;
  },
  configuration: TicketCryptoConfiguration,
): Promise<{ ticket: string; claims: RealtimeTicketClaims }> {
  const authorizationIssuedAtMs = (input.now ?? new Date()).getTime();
  const now = Math.floor(authorizationIssuedAtMs / 1000);
  const lifetimeSeconds = input.lifetimeSeconds ?? REALTIME_LIMITS.ticketLifetimeSeconds;
  if (lifetimeSeconds < 30 || lifetimeSeconds > 60) {
    throw new Error("Realtime ticket lifetime must be between 30 and 60 seconds.");
  }

  const capabilities = [...new Set(input.capabilities)];
  const claims = ticketClaimsSchema.parse({
    sub: input.subject,
    workspaceId: input.workspaceId,
    boardId: input.boardId,
    documentGenerationId: input.documentGenerationId,
    displayLabel: sanitizePresenceDisplayLabel(input.displayLabel),
    capabilities,
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    jti: input.jti ?? randomUUID(),
    authorizationIssuedAtMs,
    iat: now,
    exp: now + lifetimeSeconds,
    iss: configuration.issuer,
    aud: configuration.audience,
  });

  const ticket = await new SignJWT({
    workspaceId: claims.workspaceId,
    boardId: claims.boardId,
    documentGenerationId: claims.documentGenerationId,
    displayLabel: claims.displayLabel,
    capabilities: claims.capabilities,
    protocolVersion: claims.protocolVersion,
    authorizationIssuedAtMs: claims.authorizationIssuedAtMs,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setJti(claims.jti)
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .sign(new TextEncoder().encode(configuration.key));

  return { ticket, claims };
}

export async function verifyRealtimeTicket(
  ticket: string,
  configuration: TicketCryptoConfiguration & { now?: Date },
): Promise<RealtimeTicketClaims> {
  if (ticket.length > 4096) throw new RealtimeTicketError("invalid");
  try {
    const { payload } = await jwtVerify(
      ticket,
      new TextEncoder().encode(configuration.key),
      {
        algorithms: ["HS256"],
        issuer: configuration.issuer,
        audience: configuration.audience,
        clockTolerance: 2,
        currentDate: configuration.now,
        maxTokenAge: "60s",
      },
    );
    const claims = ticketClaimsSchema.parse(payload);
    if (claims.exp - claims.iat < 30 || claims.exp - claims.iat > 60) {
      throw new RealtimeTicketError("invalid");
    }
    if (
      claims.authorizationIssuedAtMs !== undefined &&
      Math.floor(claims.authorizationIssuedAtMs / 1_000) !== claims.iat
    ) {
      throw new RealtimeTicketError("invalid");
    }
    if (new Set(claims.capabilities).size !== claims.capabilities.length) {
      throw new RealtimeTicketError("invalid");
    }
    return claims;
  } catch (error) {
    if (error instanceof RealtimeTicketError) throw error;
    if (error instanceof errors.JWTExpired || error instanceof errors.JWTClaimValidationFailed) {
      throw new RealtimeTicketError(
        error instanceof errors.JWTExpired ? "expired" : "invalid",
      );
    }
    throw new RealtimeTicketError("invalid");
  }
}

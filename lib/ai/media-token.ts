import { createHmac } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

const AI_MEDIA_TOKEN_ISSUER = "fabric-web";
const AI_MEDIA_TOKEN_AUDIENCE = "fabric-ai-media";
const AI_MEDIA_TOKEN_LIFETIME_SECONDS = 240;
const AI_MEDIA_TOKEN_MAX_LIFETIME_SECONDS = 300;
const AI_MEDIA_TOKEN_MAX_BYTES = 4_096;
const DERIVED_SIGNING_KEY_MIN_BYTES = 32;
const AI_MEDIA_KEY_DERIVATION_DOMAIN = "fabric:ai-media:v1";

const UuidSchema = z.string().uuid();
const ContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const AiMediaClaimSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("selection-preview"),
      runId: UuidSchema,
      boardId: UuidSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("selected-drawing-preview"),
      runId: UuidSchema,
      boardId: UuidSchema,
      selectionHash: ContentHashSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("board-asset"),
      runId: UuidSchema,
      boardId: UuidSchema,
      assetId: UuidSchema,
      contentHash: ContentHashSchema,
    })
    .strict(),
]);

const AiMediaTokenPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("selection-preview"),
      runId: UuidSchema,
      boardId: UuidSchema,
      iat: z.number().int().nonnegative(),
      exp: z.number().int().positive(),
      iss: z.literal(AI_MEDIA_TOKEN_ISSUER),
      aud: z.literal(AI_MEDIA_TOKEN_AUDIENCE),
    })
    .strict(),
  z
    .object({
      kind: z.literal("selected-drawing-preview"),
      runId: UuidSchema,
      boardId: UuidSchema,
      selectionHash: ContentHashSchema,
      iat: z.number().int().nonnegative(),
      exp: z.number().int().positive(),
      iss: z.literal(AI_MEDIA_TOKEN_ISSUER),
      aud: z.literal(AI_MEDIA_TOKEN_AUDIENCE),
    })
    .strict(),
  z
    .object({
      kind: z.literal("board-asset"),
      runId: UuidSchema,
      boardId: UuidSchema,
      assetId: UuidSchema,
      contentHash: ContentHashSchema,
      iat: z.number().int().nonnegative(),
      exp: z.number().int().positive(),
      iss: z.literal(AI_MEDIA_TOKEN_ISSUER),
      aud: z.literal(AI_MEDIA_TOKEN_AUDIENCE),
    })
    .strict(),
]);

export type AiMediaClaim = z.infer<typeof AiMediaClaimSchema>;

export class AiMediaTokenError extends Error {
  constructor(readonly code: "configuration" | "invalid") {
    super("The AI media token is not valid.");
    this.name = "AiMediaTokenError";
  }
}

function signingKeyBytes(signingKey: string): Uint8Array {
  const bytes = new TextEncoder().encode(signingKey);
  if (bytes.byteLength < DERIVED_SIGNING_KEY_MIN_BYTES) {
    throw new AiMediaTokenError("configuration");
  }
  return bytes;
}

/** Derives a purpose-separated media key without using the raw auth key as JWT material. */
export function deriveAiMediaSigningKey(authSecret: string): string {
  return createHmac("sha256", authSecret)
    .update(AI_MEDIA_KEY_DERIVATION_DOMAIN, "utf8")
    .digest("base64url");
}

export async function issueAiMediaToken(input: {
  signingKey: string;
  claim: AiMediaClaim;
  now?: Date;
}): Promise<string> {
  const claim = AiMediaClaimSchema.safeParse(input.claim);
  if (!claim.success) throw new AiMediaTokenError("invalid");

  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  return new SignJWT(claim.data)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(AI_MEDIA_TOKEN_ISSUER)
    .setAudience(AI_MEDIA_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + AI_MEDIA_TOKEN_LIFETIME_SECONDS)
    .sign(signingKeyBytes(input.signingKey));
}

export async function verifyAiMediaToken(
  token: string,
  input: { signingKey: string; now?: Date },
): Promise<AiMediaClaim> {
  if (new TextEncoder().encode(token).byteLength > AI_MEDIA_TOKEN_MAX_BYTES) {
    throw new AiMediaTokenError("invalid");
  }

  try {
    const { payload } = await jwtVerify(token, signingKeyBytes(input.signingKey), {
      algorithms: ["HS256"],
      issuer: AI_MEDIA_TOKEN_ISSUER,
      audience: AI_MEDIA_TOKEN_AUDIENCE,
      typ: "JWT",
      currentDate: input.now,
      maxTokenAge: `${AI_MEDIA_TOKEN_MAX_LIFETIME_SECONDS}s`,
      clockTolerance: 2,
    });
    const parsed = AiMediaTokenPayloadSchema.safeParse(payload);
    if (!parsed.success) throw new AiMediaTokenError("invalid");

    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    if (
      parsed.data.exp <= parsed.data.iat ||
      parsed.data.exp - parsed.data.iat > AI_MEDIA_TOKEN_MAX_LIFETIME_SECONDS ||
      parsed.data.iat > now + 2
    ) {
      throw new AiMediaTokenError("invalid");
    }

    return parsed.data.kind === "board-asset"
      ? {
          kind: parsed.data.kind,
          runId: parsed.data.runId,
          boardId: parsed.data.boardId,
          assetId: parsed.data.assetId,
          contentHash: parsed.data.contentHash,
        }
      : parsed.data.kind === "selected-drawing-preview"
        ? {
            kind: parsed.data.kind,
            runId: parsed.data.runId,
            boardId: parsed.data.boardId,
            selectionHash: parsed.data.selectionHash,
          }
      : {
          kind: parsed.data.kind,
          runId: parsed.data.runId,
          boardId: parsed.data.boardId,
        };
  } catch (error) {
    if (error instanceof AiMediaTokenError) throw error;
    throw new AiMediaTokenError("invalid");
  }
}

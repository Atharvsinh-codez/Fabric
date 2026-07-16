import { z } from "zod";

const R2EnvironmentSchema = z.object({
  FABRIC_R2_ACCOUNT_ID: z.string().trim().regex(/^[a-f0-9]{32}$/i),
  FABRIC_R2_ACCESS_KEY_ID: z.string().trim().min(16).max(128),
  FABRIC_R2_SECRET_ACCESS_KEY: z.string().trim().min(32).max(256),
  FABRIC_R2_BOARD_ASSET_BUCKET: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  FABRIC_R2_AVATAR_BUCKET: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  FABRIC_R2_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
});

export type R2Environment = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  boardAssetBucket: string;
  avatarBucket: string;
  presignTtlSeconds: number;
}>;

/** Parse only server-injected values. No R2 value is safe for NEXT_PUBLIC_* exposure. */
export function parseR2Environment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): R2Environment {
  const value = R2EnvironmentSchema.parse(source);
  return Object.freeze({
    accountId: value.FABRIC_R2_ACCOUNT_ID,
    accessKeyId: value.FABRIC_R2_ACCESS_KEY_ID,
    secretAccessKey: value.FABRIC_R2_SECRET_ACCESS_KEY,
    boardAssetBucket: value.FABRIC_R2_BOARD_ASSET_BUCKET,
    avatarBucket: value.FABRIC_R2_AVATAR_BUCKET,
    presignTtlSeconds: value.FABRIC_R2_PRESIGN_TTL_SECONDS,
  });
}

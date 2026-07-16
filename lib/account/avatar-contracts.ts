import { z } from "zod";

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_AVATAR_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type SupportedAvatarMimeType = (typeof SUPPORTED_AVATAR_MIME_TYPES)[number];

export const AvatarUploadIdSchema = z.string().uuid();
export const AvatarUploadInitSchema = z
  .object({
    requestId: AvatarUploadIdSchema,
    mimeType: z.enum(SUPPORTED_AVATAR_MIME_TYPES),
    byteSize: z.number().int().positive().max(AVATAR_MAX_BYTES),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type UserAvatarProjection = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  avatarObjectKey?: string | null;
  avatarContentHash?: string | null;
  avatarMimeType?: string | null;
  avatarByteSize?: number | null;
  avatarR2Etag?: string | null;
  avatarR2Version?: string | null;
  avatarUpdatedAt?: Date | string | null;
}>;

export type ResolvedAvatar = Readonly<{
  image: string | null;
  source: "custom" | "oauth" | "initials";
}>;

function trustedOAuthImage(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function customAvatarSource(userId: string, contentHash: string): string {
  return `/api/users/${encodeURIComponent(userId)}/avatar?v=${contentHash}`;
}

/** Custom media wins; OAuth remains a durable fallback; UI initials are last. */
export function resolveUserAvatar(user: UserAvatarProjection): ResolvedAvatar {
  if (
    user.avatarObjectKey &&
    user.avatarContentHash &&
    /^[0-9a-f]{64}$/.test(user.avatarContentHash)
  ) {
    return {
      image: customAvatarSource(user.id, user.avatarContentHash),
      source: "custom",
    };
  }
  const oauthImage = trustedOAuthImage(user.image);
  return oauthImage
    ? { image: oauthImage, source: "oauth" }
    : { image: null, source: "initials" };
}

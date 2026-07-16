import type { SupportedAvatarMimeType } from "@/lib/account/avatar-contracts";

/** Concurrent, unexpired grants. This is deliberately generous and is not a rate window. */
export const AVATAR_MAX_OUTSTANDING_UPLOADS = 12;

export type AvatarUploadIntent = Readonly<{
  userId: string;
  mimeType: SupportedAvatarMimeType;
  byteSize: number;
  contentHash: string;
  r2ObjectKey: string;
}>;

export function sameAvatarUploadIntent(
  left: AvatarUploadIntent,
  right: AvatarUploadIntent,
): boolean {
  return (
    left.userId === right.userId &&
    left.mimeType === right.mimeType &&
    left.byteSize === right.byteSize &&
    left.contentHash === right.contentHash &&
    left.r2ObjectKey === right.r2ObjectKey
  );
}

export function avatarUploadCapacityAvailable(outstanding: number): boolean {
  return (
    Number.isSafeInteger(outstanding) &&
    outstanding >= 0 &&
    outstanding < AVATAR_MAX_OUTSTANDING_UPLOADS
  );
}

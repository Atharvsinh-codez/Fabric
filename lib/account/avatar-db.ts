import "server-only";

import { users } from "@/db/schema/auth";

/**
 * Columns required to resolve a user's effective avatar without exposing the
 * underlying private object key to API consumers.
 */
export const userAvatarSelection = {
  id: users.id,
  image: users.image,
  avatarObjectKey: users.avatarObjectKey,
  avatarContentHash: users.avatarContentHash,
  avatarMimeType: users.avatarMimeType,
  avatarByteSize: users.avatarByteSize,
  avatarR2Etag: users.avatarR2Etag,
  avatarR2Version: users.avatarR2Version,
  avatarUpdatedAt: users.avatarUpdatedAt,
};

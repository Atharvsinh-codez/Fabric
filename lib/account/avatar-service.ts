import "server-only";

import {
  AVATAR_MAX_BYTES,
  SUPPORTED_AVATAR_MIME_TYPES,
  resolveUserAvatar,
  type SupportedAvatarMimeType,
} from "@/lib/account/avatar-contracts";
import {
  avatarRepository,
  type AvatarRepository,
} from "@/lib/account/avatar-repository";
import {
  declaredMimeMatchesDetected,
  detectBoardAssetMimeType,
} from "@/lib/boards/assets/contracts";
import { BoardApiError } from "@/lib/boards/http";
import {
  getPrivateObjectStore,
  type PrivateObjectStore,
} from "@/lib/storage/r2/private-object-store";
import {
  avatarFinalObjectKey,
  avatarUploadObjectKey,
} from "@/lib/storage/r2/object-keys";

const AVATAR_UPLOAD_TTL_MS = 5 * 60 * 1_000;
const META = {
  owner: "fabric-owner-id",
  hash: "fabric-content-sha256",
  size: "fabric-byte-size",
  type: "fabric-media-type",
  kind: "fabric-upload-kind",
  expires: "fabric-expires-at",
} as const;

type Dependencies = Readonly<{
  repository: AvatarRepository;
  objectStore: PrivateObjectStore;
  now: () => Date;
}>;

const defaultDependencies = (): Dependencies => ({
  repository: avatarRepository,
  objectStore: getPrivateObjectStore(),
  now: () => new Date(),
});

export async function initiateAvatarUpload(
  input: {
    userId: string;
    requestId: string;
    mimeType: SupportedAvatarMimeType;
    byteSize: number;
    contentHash: string;
  },
  dependencies: Dependencies = defaultDependencies(),
) {
  const now = dependencies.now();
  const expiresAt = new Date(now.getTime() + AVATAR_UPLOAD_TTL_MS);
  const uploadId = input.requestId;
  const key = avatarUploadObjectKey(input.userId, uploadId);
  const reservation = await dependencies.repository.reserveUpload({
    uploadId,
    userId: input.userId,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    contentHash: input.contentHash,
    r2ObjectKey: key,
    expiresAt,
    now,
  });
  const signed = await dependencies.objectStore.createUpload({
    bucket: "avatars",
    key: reservation.r2ObjectKey,
    contentType: reservation.mimeType,
    byteSize: reservation.byteSize,
    metadata: {
      [META.owner]: input.userId,
      [META.hash]: reservation.contentHash,
      [META.size]: String(reservation.byteSize),
      [META.type]: reservation.mimeType,
      [META.kind]: "avatar",
      [META.expires]: reservation.expiresAt.toISOString(),
    },
    now,
    expiresAt: reservation.expiresAt,
  });
  return {
    upload: {
      id: uploadId,
      method: signed.method,
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt,
    },
  } as const;
}

export async function finalizeAvatarUpload(
  input: { userId: string; uploadId: string },
  dependencies: Dependencies = defaultDependencies(),
) {
  const key = avatarUploadObjectKey(input.userId, input.uploadId);
  const finalKey = avatarFinalObjectKey(input.userId, input.uploadId);
  const current = await dependencies.repository.get(input.userId);
  if (current.avatarObjectKey === finalKey) {
    return { avatar: resolveUserAvatar(current) } as const;
  }
  const reservation = await dependencies.repository.getUpload(input);
  const now = dependencies.now();
  if (
    reservation.status !== "pending" ||
    reservation.expiresAt.getTime() <= now.getTime() ||
    reservation.r2ObjectKey !== key
  ) {
    throw new BoardApiError(
      410,
      "avatar_upload_expired",
      "This avatar upload has expired.",
    );
  }
  let object;
  try {
    object = await dependencies.objectStore.inspect({
      bucket: "avatars",
      key,
      maxBytes: AVATAR_MAX_BYTES,
    });
  } catch {
    const finalized = await dependencies.repository.get(input.userId);
    if (finalized.avatarObjectKey === finalKey) {
      return { avatar: resolveUserAvatar(finalized) } as const;
    }
    throw new BoardApiError(
      409,
      "avatar_upload_not_ready",
      "The avatar upload is not available to finalize yet.",
    );
  }

  const mimeType = object.metadata[META.type];
  const detected = detectBoardAssetMimeType(object.firstBytes);
  const supportedMimeType = SUPPORTED_AVATAR_MIME_TYPES.find(
    (candidate) => candidate === mimeType,
  );
  const valid =
    object.metadata[META.owner] === input.userId &&
    object.metadata[META.kind] === "avatar" &&
    object.contentHash === reservation.contentHash &&
    object.byteSize === reservation.byteSize &&
    object.metadata[META.hash] === reservation.contentHash &&
    object.metadata[META.size] === String(reservation.byteSize) &&
    object.metadata[META.type] === reservation.mimeType &&
    object.metadata[META.expires] === reservation.expiresAt.toISOString() &&
    Boolean(supportedMimeType) &&
    supportedMimeType === reservation.mimeType &&
    detected === supportedMimeType &&
    Boolean(
      supportedMimeType &&
      declaredMimeMatchesDetected(object.contentType, supportedMimeType),
    ) &&
    reservation.expiresAt.getTime() > dependencies.now().getTime() &&
    Boolean(object.etag);
  if (!valid || !supportedMimeType) {
    await Promise.allSettled([
      dependencies.objectStore.delete({ bucket: "avatars", key }),
      dependencies.repository.rejectUpload({
        userId: input.userId,
        uploadId: input.uploadId,
        now: dependencies.now(),
      }),
    ]);
    throw new BoardApiError(
      422,
      "avatar_verification_failed",
      "The uploaded avatar did not match the authorized file.",
    );
  }

  let promoted;
  try {
    promoted = await dependencies.objectStore.promote({
      bucket: "avatars",
      sourceKey: key,
      destinationKey: finalKey,
      sourceEtag: object.etag!,
    });
  } catch {
    const finalized = await dependencies.repository.get(input.userId);
    if (finalized.avatarObjectKey === finalKey) {
      return { avatar: resolveUserAvatar(finalized) } as const;
    }
    throw new BoardApiError(
      409,
      "avatar_promotion_failed",
      "The verified avatar could not be made ready yet.",
    );
  }

  let result;
  try {
    result = await dependencies.repository.replace({
      userId: input.userId,
      uploadId: input.uploadId,
      stagingObjectKey: key,
      avatarObjectKey: finalKey,
      avatarContentHash: object.contentHash,
      avatarMimeType: supportedMimeType,
      avatarByteSize: object.byteSize,
      avatarR2Etag: promoted.etag,
      avatarR2Version: promoted.version,
      avatarUpdatedAt: dependencies.now(),
    });
  } catch (error) {
    const finalized = await dependencies.repository.get(input.userId);
    if (finalized.avatarObjectKey === finalKey) {
      return { avatar: resolveUserAvatar(finalized) } as const;
    }
    // A failed database response can be ambiguous after commit. Retain the
    // immutable promoted object so this exact upload can be retried safely.
    throw error;
  }
  if (result.previousObjectKey && result.previousObjectKey !== finalKey) {
    await dependencies.objectStore
      .delete({ bucket: "avatars", key: result.previousObjectKey })
      .catch(() => undefined);
  }
  await dependencies.objectStore
    .delete({ bucket: "avatars", key })
    .catch(() => undefined);
  return { avatar: resolveUserAvatar(result.user) } as const;
}

export async function getAccountAvatar(
  userId: string,
  repository: AvatarRepository = avatarRepository,
) {
  const user = await repository.get(userId);
  return { avatar: resolveUserAvatar(user) } as const;
}

export async function clearAccountAvatar(
  userId: string,
  dependencies: Pick<Dependencies, "repository" | "objectStore"> = {
    repository: avatarRepository,
    objectStore: getPrivateObjectStore(),
  },
) {
  const result = await dependencies.repository.clear(userId);
  if (result.previousObjectKey) {
    await dependencies.objectStore
      .delete({ bucket: "avatars", key: result.previousObjectKey })
      .catch(() => undefined);
  }
  return { avatar: resolveUserAvatar(result.user) } as const;
}

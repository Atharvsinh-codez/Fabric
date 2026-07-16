export function boardAssetUploadObjectKey(
  boardId: string,
  uploadId: string,
): string {
  return `boards/${boardId}/uploads/${uploadId}`;
}

export function boardAssetFinalObjectKey(
  boardId: string,
  storageId: string,
  contentHash: string,
): string {
  return `boards/${boardId}/assets/${storageId}/${contentHash}`;
}

export function avatarUploadObjectKey(userId: string, uploadId: string): string {
  return `avatars/${userId}/uploads/${uploadId}`;
}

export function avatarFinalObjectKey(userId: string, uploadId: string): string {
  return `avatars/${userId}/assets/${uploadId}`;
}

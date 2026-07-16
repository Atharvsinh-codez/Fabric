"use client";

import {
  AVATAR_MAX_BYTES,
  SUPPORTED_AVATAR_MIME_TYPES,
  type ResolvedAvatar,
  type SupportedAvatarMimeType,
} from "@/lib/account/avatar-contracts";
import {
  fetchFinalizeWithRetry,
  fetchIdempotentWithRetry,
  transferWriteOnceUpload,
} from "@/lib/storage/r2/upload-retry-client";

type UploadGrant = Readonly<{
  id: string;
  url: string;
  headers: Readonly<Record<string, string>>;
}>;

function apiMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return fallback;
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseAvatar(payload: unknown): ResolvedAvatar | null {
  if (!payload || typeof payload !== "object" || !("avatar" in payload))
    return null;
  const avatar = payload.avatar;
  if (!avatar || typeof avatar !== "object") return null;
  if (
    !("image" in avatar) ||
    !("source" in avatar) ||
    (avatar.image !== null && typeof avatar.image !== "string") ||
    !["custom", "oauth", "initials"].includes(String(avatar.source))
  ) {
    return null;
  }
  return avatar as ResolvedAvatar;
}

function parseGrant(payload: unknown): UploadGrant | null {
  if (!payload || typeof payload !== "object" || !("upload" in payload))
    return null;
  const upload = payload.upload;
  if (!upload || typeof upload !== "object") return null;
  if (
    !("id" in upload) ||
    !("url" in upload) ||
    !("method" in upload) ||
    !("headers" in upload) ||
    typeof upload.id !== "string" ||
    typeof upload.url !== "string" ||
    upload.method !== "PUT" ||
    !upload.headers ||
    typeof upload.headers !== "object"
  ) {
    return null;
  }
  try {
    if (new URL(upload.url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(upload.headers)) {
    const normalized = name.toLowerCase();
    if (
      typeof value !== "string" ||
      (normalized !== "content-type" &&
        normalized !== "if-none-match" &&
        !normalized.startsWith("x-amz-meta-fabric-"))
    ) {
      return null;
    }
    headers[normalized] = value;
  }
  if (!headers["content-type"] || headers["if-none-match"] !== "*") return null;
  return { id: upload.id, url: upload.url, headers };
}

function fileMimeType(file: File): SupportedAvatarMimeType | null {
  const declared = file.type.split(";", 1)[0]?.trim().toLowerCase();
  const normalized = declared === "image/jpg" ? "image/jpeg" : declared;
  return (
    SUPPORTED_AVATAR_MIME_TYPES.find((candidate) => candidate === normalized) ??
    null
  );
}

async function contentHash(file: File): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loadAccountAvatar(
  signal?: AbortSignal,
): Promise<ResolvedAvatar> {
  const response = await fetch("/api/account/avatar", {
    credentials: "same-origin",
    signal,
  });
  const payload = await json(response);
  const avatar = parseAvatar(payload);
  if (!response.ok || !avatar)
    throw new Error(apiMessage(payload, "Avatar could not be loaded."));
  return avatar;
}

export async function uploadAccountAvatar(
  file: File,
  signal?: AbortSignal,
): Promise<ResolvedAvatar> {
  const mimeType = fileMimeType(file);
  if (!mimeType) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) {
    throw new Error("Avatar images must be non-empty and 5 MiB or smaller.");
  }
  const hash = await contentHash(file);
  const requestId = crypto.randomUUID();
  const initiationBody = JSON.stringify({
    requestId,
    mimeType,
    byteSize: file.size,
    contentHash: hash,
  });
  const initResponse = await fetchIdempotentWithRetry({
    signal,
    request: () =>
      fetch("/api/account/avatar/uploads", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: initiationBody,
        signal,
      }),
  });
  const initPayload = await json(initResponse);
  const grant = parseGrant(initPayload);
  if (!initResponse.ok || !grant) {
    throw new Error(
      apiMessage(initPayload, "Avatar upload could not be started."),
    );
  }

  const transferred = await transferWriteOnceUpload({
    fetcher: fetch,
    url: grant.url,
    headers: grant.headers,
    body: file,
    expectedByteSize: file.size,
    signal,
  });
  if (!transferred)
    throw new Error("Avatar could not be transferred to private storage.");

  const finalizeResponse = await fetchFinalizeWithRetry({
    signal,
    request: () =>
      fetch(
        `/api/account/avatar/uploads/${encodeURIComponent(grant.id)}/finalize`,
        {
          method: "POST",
          credentials: "same-origin",
          signal,
        },
      ),
  });
  const finalizePayload = await json(finalizeResponse);
  const avatar = parseAvatar(finalizePayload);
  if (!finalizeResponse.ok || !avatar) {
    throw new Error(
      apiMessage(finalizePayload, "Avatar upload could not be finalized."),
    );
  }
  return avatar;
}

export async function removeAccountAvatar(
  signal?: AbortSignal,
): Promise<ResolvedAvatar> {
  const response = await fetch("/api/account/avatar", {
    method: "DELETE",
    credentials: "same-origin",
    signal,
  });
  const payload = await json(response);
  const avatar = parseAvatar(payload);
  if (!response.ok || !avatar)
    throw new Error(apiMessage(payload, "Avatar could not be removed."));
  return avatar;
}

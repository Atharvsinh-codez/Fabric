"use client";

const RETRYABLE_RESPONSE_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);

function canRetry(signal: AbortSignal | undefined): boolean {
  return !signal?.aborted;
}

/**
 * Retries one ambiguous direct PUT. A 412 is success for Fabric's opaque,
 * write-once upload key: it means the first PUT reached R2 but its response was
 * lost. Finalization still verifies the complete object before accepting it.
 */
export async function transferWriteOnceUpload(input: {
  fetcher: typeof fetch;
  url: string;
  headers: Readonly<Record<string, string>>;
  body: Blob;
  expectedByteSize?: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  // Fetch derives the forbidden Content-Length header from Blob.size. Keeping
  // the body as a Blob/File lets it satisfy the presigned exact-length header
  // without attempting to set that browser-controlled header in JavaScript.
  const expectedByteSize = input.expectedByteSize ?? input.body.size;
  if (
    !Number.isSafeInteger(expectedByteSize) ||
    expectedByteSize <= 0 ||
    input.body.size !== expectedByteSize
  ) {
    throw new Error("The upload body does not match its authorized byte size.");
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await input.fetcher(input.url, {
        method: "PUT",
        credentials: "omit",
        headers: input.headers,
        body: input.body,
        signal: input.signal,
      });
      if (response.ok || response.status === 412) return true;
      if (
        attempt === 0 &&
        canRetry(input.signal) &&
        RETRYABLE_RESPONSE_STATUSES.has(response.status)
      ) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      return false;
    } catch (error) {
      if (attempt > 0 || !canRetry(input.signal)) throw error;
    }
  }
  return false;
}

/** Retry one idempotent same-origin request after a lost response or 5xx. */
export async function fetchIdempotentWithRetry(input: {
  request: () => Promise<Response>;
  signal?: AbortSignal;
}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await input.request();
      if (
        attempt === 0 &&
        canRetry(input.signal) &&
        RETRYABLE_RESPONSE_STATUSES.has(response.status)
      ) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      return response;
    } catch (error) {
      if (attempt > 0 || !canRetry(input.signal)) throw error;
    }
  }
  throw new Error("The idempotent upload request did not return a response.");
}

export async function fetchFinalizeWithRetry(
  input: Parameters<typeof fetchIdempotentWithRetry>[0],
): Promise<Response> {
  return fetchIdempotentWithRetry(input);
}

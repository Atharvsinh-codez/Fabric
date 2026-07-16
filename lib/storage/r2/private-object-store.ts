import "server-only";

import { createHash } from "node:crypto";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  parseR2Environment,
  type R2Environment,
} from "@/lib/storage/r2/environment";

export type R2Bucket = "board-assets" | "avatars";

export type PresignedR2Upload = Readonly<{
  url: string;
  method: "PUT";
  headers: Readonly<Record<string, string>>;
  expiresAt: string;
}>;

export type InspectedR2Object = Readonly<{
  byteSize: number;
  contentType: string | null;
  contentHash: string;
  firstBytes: Uint8Array;
  metadata: Readonly<Record<string, string>>;
  etag: string | null;
  version: string | null;
}>;

export type R2ObjectResponse = Readonly<{
  body: ReadableStream<Uint8Array>;
  byteSize: number | null;
  contentRange: string | null;
  contentType: string | null;
  etag: string | null;
}>;

export type PromotedR2Object = Readonly<{
  etag: string;
  version: string | null;
}>;

export interface PrivateObjectStore {
  createUpload(input: {
    bucket: R2Bucket;
    key: string;
    contentType: string;
    byteSize: number;
    metadata: Readonly<Record<string, string>>;
    now?: Date;
    expiresAt?: Date;
  }): Promise<PresignedR2Upload>;
  inspect(input: {
    bucket: R2Bucket;
    key: string;
    maxBytes: number;
  }): Promise<InspectedR2Object>;
  promote(input: {
    bucket: R2Bucket;
    sourceKey: string;
    destinationKey: string;
    sourceEtag: string;
  }): Promise<PromotedR2Object>;
  get(input: {
    bucket: R2Bucket;
    key: string;
    range?: string | null;
  }): Promise<R2ObjectResponse>;
  delete(input: { bucket: R2Bucket; key: string }): Promise<void>;
}

type StreamingBody = AsyncIterable<Uint8Array | ArrayBuffer | string>;

function normalizeChunk(chunk: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  if (chunk instanceof Uint8Array) return chunk;
  return new Uint8Array(chunk);
}

function asStreamingBody(body: unknown): StreamingBody {
  if (
    body &&
    typeof body === "object" &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  ) {
    return body as StreamingBody;
  }
  throw new Error("R2 returned a non-streaming object body.");
}

function readableStreamFrom(body: StreamingBody): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await iterator.next();
        if (item.done) {
          controller.close();
          return;
        }
        controller.enqueue(normalizeChunk(item.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function assertObjectKey(key: string): void {
  if (
    key.length < 1 ||
    key.length > 900 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid private object key.");
  }
}

function unquoteEtag(value: string | undefined): string | null {
  return value?.replace(/^"|"$/g, "") || null;
}

export class R2PrivateObjectStore implements PrivateObjectStore {
  readonly #client: S3Client;

  constructor(
    private readonly environment: R2Environment,
    client?: S3Client,
  ) {
    this.#client =
      client ??
      new S3Client({
        region: "auto",
        endpoint: `https://${environment.accountId}.r2.cloudflarestorage.com`,
        // R2 rejects the SDK's optional automatic checksum negotiation. Fabric
        // verifies SHA-256 while finalizing instead.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        credentials: {
          accessKeyId: environment.accessKeyId,
          secretAccessKey: environment.secretAccessKey,
        },
      });
  }

  #bucket(bucket: R2Bucket): string {
    return bucket === "avatars"
      ? this.environment.avatarBucket
      : this.environment.boardAssetBucket;
  }

  async createUpload(input: {
    bucket: R2Bucket;
    key: string;
    contentType: string;
    byteSize: number;
    metadata: Readonly<Record<string, string>>;
    now?: Date;
    expiresAt?: Date;
  }): Promise<PresignedR2Upload> {
    assertObjectKey(input.key);
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
      throw new Error("Private object uploads require an exact positive byte size.");
    }
    const issuedAt = input.now ?? new Date();
    const requestedTtlSeconds = input.expiresAt
      ? Math.floor((input.expiresAt.getTime() - issuedAt.getTime()) / 1_000)
      : this.environment.presignTtlSeconds;
    const expiresIn = Math.min(
      this.environment.presignTtlSeconds,
      requestedTtlSeconds,
    );
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 1) {
      throw new Error("Private object upload expiry must be in the future.");
    }
    const metadata = Object.fromEntries(
      Object.entries(input.metadata).map(([name, value]) => [name.toLowerCase(), value]),
    );
    const metadataHeaders = Object.keys(metadata).map((name) => `x-amz-meta-${name}`);
    const signedHeaders = new Set([
      "content-length",
      "content-type",
      "if-none-match",
      ...metadataHeaders,
    ]);
    const url = await getSignedUrl(
      this.#client,
      new PutObjectCommand({
        Bucket: this.#bucket(input.bucket),
        Key: input.key,
        ContentLength: input.byteSize,
        ContentType: input.contentType,
        // A presigned URL may otherwise overwrite the verified object until it
        // expires. This makes each opaque upload key write-once.
        IfNoneMatch: "*",
        Metadata: metadata,
      }),
      {
        expiresIn,
        signingDate: issuedAt,
        signableHeaders: signedHeaders,
        unhoistableHeaders: signedHeaders,
      },
    );
    return {
      url,
      method: "PUT",
      headers: Object.freeze({
        "content-type": input.contentType,
        "if-none-match": "*",
        ...Object.fromEntries(
          Object.entries(metadata).map(([name, value]) => [`x-amz-meta-${name}`, value]),
        ),
      }),
      expiresAt: new Date(
        issuedAt.getTime() + expiresIn * 1_000,
      ).toISOString(),
    };
  }

  async inspect(input: {
    bucket: R2Bucket;
    key: string;
    maxBytes: number;
  }): Promise<InspectedR2Object> {
    assertObjectKey(input.key);
    const target = { Bucket: this.#bucket(input.bucket), Key: input.key };
    const head = await this.#client.send(new HeadObjectCommand(target));
    const byteSize = head.ContentLength;
    if (!Number.isSafeInteger(byteSize) || !byteSize || byteSize > input.maxBytes) {
      throw new Error("R2 object size is missing or outside the allowed range.");
    }

    const object = await this.#client.send(new GetObjectCommand(target));
    const body = asStreamingBody(object.Body);
    const hash = createHash("sha256");
    const firstBytes = new Uint8Array(16);
    let firstByteCount = 0;
    let streamedBytes = 0;

    for await (const rawChunk of body) {
      const chunk = normalizeChunk(rawChunk);
      streamedBytes += chunk.byteLength;
      if (streamedBytes > input.maxBytes) {
        throw new Error("R2 object exceeded the allowed size while streaming.");
      }
      hash.update(chunk);
      if (firstByteCount < firstBytes.byteLength) {
        const copied = Math.min(chunk.byteLength, firstBytes.byteLength - firstByteCount);
        firstBytes.set(chunk.subarray(0, copied), firstByteCount);
        firstByteCount += copied;
      }
    }
    if (streamedBytes !== byteSize) {
      throw new Error("R2 object length changed during verification.");
    }

    return {
      byteSize,
      contentType: head.ContentType?.split(";", 1)[0]?.trim().toLowerCase() || null,
      contentHash: hash.digest("hex"),
      firstBytes: firstBytes.slice(0, firstByteCount),
      metadata: Object.freeze({ ...(head.Metadata ?? {}) }),
      etag: unquoteEtag(head.ETag),
      version: head.VersionId ?? null,
    };
  }

  async get(input: {
    bucket: R2Bucket;
    key: string;
    range?: string | null;
  }): Promise<R2ObjectResponse> {
    assertObjectKey(input.key);
    const object = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucket(input.bucket),
        Key: input.key,
        ...(input.range ? { Range: input.range } : {}),
      }),
    );
    return {
      body: readableStreamFrom(asStreamingBody(object.Body)),
      byteSize: Number.isSafeInteger(object.ContentLength) ? object.ContentLength ?? null : null,
      contentRange: object.ContentRange ?? null,
      contentType: object.ContentType?.split(";", 1)[0]?.trim().toLowerCase() || null,
      etag: unquoteEtag(object.ETag),
    };
  }

  async promote(input: {
    bucket: R2Bucket;
    sourceKey: string;
    destinationKey: string;
    sourceEtag: string;
  }): Promise<PromotedR2Object> {
    assertObjectKey(input.sourceKey);
    assertObjectKey(input.destinationKey);
    const bucket = this.#bucket(input.bucket);
    const encodedSource = `${bucket}/${input.sourceKey
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
    await this.#client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: input.destinationKey,
        CopySource: encodedSource,
        CopySourceIfMatch: `"${input.sourceEtag.replace(/^"|"$/g, "")}"`,
        MetadataDirective: "COPY",
      }),
    );
    const promoted = await this.#client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: input.destinationKey }),
    );
    const etag = unquoteEtag(promoted.ETag);
    if (!etag) throw new Error("Promoted R2 object is missing its ETag.");
    return { etag, version: promoted.VersionId ?? null };
  }

  async delete(input: { bucket: R2Bucket; key: string }): Promise<void> {
    assertObjectKey(input.key);
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucket(input.bucket),
        Key: input.key,
      }),
    );
  }
}

let defaultStore: R2PrivateObjectStore | undefined;

export function getPrivateObjectStore(): R2PrivateObjectStore {
  defaultStore ??= new R2PrivateObjectStore(parseR2Environment(process.env));
  return defaultStore;
}

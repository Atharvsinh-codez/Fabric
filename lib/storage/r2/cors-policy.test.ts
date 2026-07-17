import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("production R2 CORS policy", () => {
  it("allows only exact-origin signed PUT headers", async () => {
    const policy = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "cloudflare",
          "r2-cors.production.json",
        ),
        "utf8",
      ),
    ) as {
      rules: Array<{
        allowed: {
          origins: string[];
          methods: string[];
          headers: string[];
        };
        maxAgeSeconds: number;
      }>;
    };

    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0]).toEqual({
      allowed: {
        origins: ["https://fabric.athrix.me"],
        methods: ["PUT"],
        headers: [
          "Content-Type",
          "If-None-Match",
          "x-amz-meta-fabric-content-sha256",
          "x-amz-meta-fabric-byte-size",
          "x-amz-meta-fabric-media-type",
          "x-amz-meta-fabric-upload-kind",
          "x-amz-meta-fabric-owner-id",
          "x-amz-meta-fabric-expires-at",
        ],
      },
      maxAgeSeconds: 3600,
    });
    expect(JSON.stringify(policy)).not.toContain('"*"');
  });
});

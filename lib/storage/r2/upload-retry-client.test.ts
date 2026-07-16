import { describe, expect, it, vi } from "vitest";

import {
  fetchFinalizeWithRetry,
  transferWriteOnceUpload,
} from "./upload-retry-client";

describe("write-once upload retry", () => {
  it("treats 412 after a lost PUT response as an uploaded object", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(new Response(null, { status: 412 }));

    await expect(
      transferWriteOnceUpload({
        fetcher,
        url: "https://private.example/upload",
        headers: { "content-type": "image/png", "if-none-match": "*" },
        body: new Blob(["image"]),
        expectedByteSize: 5,
      }),
    ).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      credentials: "omit",
      headers: { "content-type": "image/png", "if-none-match": "*" },
    });
    const transferredBody = fetcher.mock.calls[0]?.[1]?.body;
    expect(transferredBody).toBeInstanceOf(Blob);
    expect((transferredBody as Blob).size).toBe(5);
    expect(
      (fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>)[
        "content-length"
      ],
    ).toBeUndefined();
  });

  it("retries one ambiguous finalize response", async () => {
    const request = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const response = await fetchFinalizeWithRetry({ request });

    expect(response.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not retry an aborted transfer", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException("Aborted", "AbortError");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);

    await expect(
      transferWriteOnceUpload({
        fetcher,
        url: "https://private.example/upload",
        headers: { "content-type": "image/png", "if-none-match": "*" },
        body: new Blob(["image"]),
        expectedByteSize: 5,
        signal: controller.signal,
      }),
    ).rejects.toBe(error);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not send a Blob that differs from the authorized byte size", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      transferWriteOnceUpload({
        fetcher,
        url: "https://private.example/upload",
        headers: { "content-type": "image/png", "if-none-match": "*" },
        body: new Blob(["image"]),
        expectedByteSize: 6,
      }),
    ).rejects.toThrow("authorized byte size");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

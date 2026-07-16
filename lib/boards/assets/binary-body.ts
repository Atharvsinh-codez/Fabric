import { BoardApiError } from "@/lib/boards/http";

export async function readBoundedBinaryBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    throw new BoardApiError(
      415,
      "unsupported_content_encoding",
      "Compressed asset uploads are not supported.",
    );
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new BoardApiError(400, "invalid_content_length", "Invalid content length.");
    }
    if (declaredLength > maxBytes) {
      throw new BoardApiError(413, "asset_too_large", "The asset is too large.");
    }
  }

  if (!request.body) {
    throw new BoardApiError(422, "empty_asset", "Choose a non-empty image to upload.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new BoardApiError(413, "asset_too_large", "The asset is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BoardApiError) throw error;
    throw new BoardApiError(400, "invalid_asset_body", "The asset body could not be read.");
  }

  if (byteLength === 0) {
    throw new BoardApiError(422, "empty_asset", "Choose a non-empty image to upload.");
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(encoded: string, maximumBytes: number): Uint8Array {
  if (!BASE64_PATTERN.test(encoded)) {
    throw new TypeError("The realtime payload is not canonical base64.");
  }
  const binary = atob(encoded);
  if (binary.length === 0 || binary.length > maximumBytes) {
    throw new RangeError("The decoded realtime payload is outside the allowed size.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64(bytes) !== encoded) {
    throw new TypeError("The realtime payload is not canonical base64.");
  }
  return bytes;
}

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is required for durable realtime updates.");
  }
  const input = new Uint8Array(bytes).buffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

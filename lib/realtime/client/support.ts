export type RealtimeBrowserSupport = {
  fetch: boolean;
  indexedDb: boolean;
  secureRandom: boolean;
  webCrypto: boolean;
  webSocket: boolean;
};

export function detectRealtimeBrowserSupport(): RealtimeBrowserSupport {
  return {
    fetch: typeof globalThis.fetch === "function",
    indexedDb: typeof globalThis.indexedDB !== "undefined",
    secureRandom:
      typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.randomUUID === "function",
    webCrypto:
      typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.subtle !== "undefined",
    webSocket: typeof globalThis.WebSocket !== "undefined",
  };
}

export function requireUuid(value: string, label: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(`${label} must be a UUID.`);
  }
  return value;
}

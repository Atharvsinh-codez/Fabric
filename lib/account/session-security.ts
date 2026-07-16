import { z } from "zod";

const opaqueSessionIdSchema = z.uuid();

export function parseOpaqueSessionId(value: string): string | null {
  const result = opaqueSessionIdSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function isSameOriginMutation(requestUrl: string, originHeader: string | null): boolean {
  if (!originHeader) return false;

  try {
    return new URL(originHeader).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

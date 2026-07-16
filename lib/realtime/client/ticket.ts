import { z } from "zod";

import {
  REALTIME_CAPABILITIES,
  REALTIME_PROTOCOL_VERSION,
  type RealtimeCapability,
} from "../constants";

const ticketResponseSchema = z
  .object({
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    ticket: z.string().min(64).max(4096),
    expiresAt: z.string().datetime({ offset: true }),
    boardId: z.string().uuid(),
    documentGenerationId: z.string().uuid(),
    capabilities: z.array(z.enum(REALTIME_CAPABILITIES)).min(1).max(3),
  })
  .strict();

export type RealtimeTicket = {
  ticket: string;
  expiresAt: string;
  boardId: string;
  documentGenerationId: string;
  capabilities: RealtimeCapability[];
};

export class RealtimeTicketRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super("A realtime connection ticket could not be issued.");
    this.name = "RealtimeTicketRequestError";
  }
}

export async function requestRealtimeTicket(input: {
  boardId: string;
  endpoint?: string;
  fetchImplementation?: typeof fetch;
  pageOrigin?: string;
  signal?: AbortSignal;
}): Promise<RealtimeTicket> {
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new RealtimeTicketRequestError(0);
  }
  const pageOrigin = input.pageOrigin ?? globalThis.location?.origin;
  if (!pageOrigin) throw new RealtimeTicketRequestError(0);

  const endpoint = new URL(input.endpoint ?? "/api/realtime/ticket", pageOrigin);
  if (endpoint.origin !== pageOrigin || endpoint.username || endpoint.password) {
    throw new TypeError("The realtime ticket endpoint must be same-origin.");
  }

  const response = await fetchImplementation(endpoint, {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ boardId: input.boardId }),
    signal: input.signal,
  });
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new RealtimeTicketRequestError(
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
  return ticketResponseSchema.parse(await response.json());
}

export function resolveRealtimeUrl(
  explicitUrl?: string,
  pageUrl?: string,
  scope?: Readonly<{ boardId: string; documentGenerationId: string }>,
): string {
  const configured = explicitUrl ?? process.env.NEXT_PUBLIC_REALTIME_URL;
  if (!configured) throw new TypeError("NEXT_PUBLIC_REALTIME_URL is not configured.");
  const page = pageUrl ?? globalThis.location?.href;
  const target = new URL(configured, page);
  if (
    (target.protocol !== "ws:" && target.protocol !== "wss:") ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/realtime"
  ) {
    throw new TypeError("The realtime WebSocket URL is not allowed.");
  }
  if (page && new URL(page).protocol === "https:" && target.protocol !== "wss:") {
    throw new TypeError("Secure pages require a secure realtime WebSocket URL.");
  }
  if (scope) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(scope.boardId) || !uuid.test(scope.documentGenerationId)) {
      throw new TypeError("The realtime room scope is invalid.");
    }
    target.pathname = `/realtime/${scope.boardId}/${scope.documentGenerationId}`;
  }
  return target.toString();
}

export class BoardApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BoardApiError";
  }
}

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
  Vary: "Cookie",
};

export function apiJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) headers.set(name, value);
  return Response.json(data, { ...init, headers });
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BoardApiError(413, "request_too_large", "The request body is too large.");
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    throw new BoardApiError(400, "invalid_body", "The request body could not be read.");
  }
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new BoardApiError(413, "request_too_large", "The request body is too large.");
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new BoardApiError(400, "invalid_json", "Send a valid JSON request body.");
  }
}

export function requireSameOrigin(
  request: Request,
  configuredApplicationUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL,
): void {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new BoardApiError(403, "forbidden_origin", "This request origin is not allowed.");
  }

  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) {
    throw new BoardApiError(403, "missing_origin", "A same-origin request is required.");
  }

  try {
    const expectedOrigin = configuredApplicationUrl
      ? new URL(configuredApplicationUrl).origin
      : new URL(request.url).origin;
    if (new URL(source).origin !== expectedOrigin) {
      throw new BoardApiError(403, "forbidden_origin", "This request origin is not allowed.");
    }
  } catch (error) {
    if (error instanceof BoardApiError) throw error;
    throw new BoardApiError(403, "forbidden_origin", "This request origin is not allowed.");
  }
}

export function invalidRequest(): BoardApiError {
  return new BoardApiError(422, "invalid_request", "The request failed validation.");
}

export function handleApiError(error: unknown): Response {
  if (error instanceof BoardApiError) {
    return apiJson(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
  }
  if (error instanceof Error && error.name === "AuthenticationRequiredError") {
    return apiJson(
      { error: { code: "unauthorized", message: "Sign in to continue." } },
      { status: 401 },
    );
  }
  if (error instanceof Error && error.name === "AccountSuspendedError") {
    return apiJson(
      { error: { code: "account_suspended", message: "This account cannot access Fabric." } },
      { status: 403 },
    );
  }

  return apiJson(
    { error: { code: "internal_error", message: "The request could not be completed." } },
    { status: 500 },
  );
}

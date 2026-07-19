import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw { destination, type: "NEXT_REDIRECT" };
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    cache:
      <Arguments extends readonly unknown[], Result>(
        callback: (...arguments_: Arguments) => Result,
      ) =>
      (...arguments_: Arguments): Result =>
        callback(...arguments_),
  };
});

import { redirectAuthenticatedPagePrincipal } from "./page-principal";

async function expectRedirect(destination: string): Promise<void> {
  await expect(redirectAuthenticatedPagePrincipal()).rejects.toEqual({
    destination,
    type: "NEXT_REDIRECT",
  });
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  expect(mocks.redirect).toHaveBeenCalledWith(destination);
}

describe("redirectAuthenticatedPagePrincipal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an active account directly to the workspace app", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-id",
        name: "Active User",
        email: "active@example.com",
        image: null,
        isSuspended: false,
      },
    });

    await expectRedirect("/app");
  });

  it("allows an unauthenticated visitor to remain on the auth page", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(redirectAuthenticatedPagePrincipal()).resolves.toBeUndefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sends a suspended account to the access-denied screen", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "suspended-user-id",
        name: "Suspended User",
        email: "suspended@example.com",
        image: null,
        isSuspended: true,
      },
    });

    await expectRedirect("/login/error?error=AccessDenied");
  });

  it("fails closed on an unexpected session lookup error", async () => {
    mocks.auth.mockRejectedValue(new Error("Session store unavailable"));

    await expectRedirect("/login/error?error=SessionUnavailable");
  });
});

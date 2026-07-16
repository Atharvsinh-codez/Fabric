import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));

import {
  AccountSuspendedError,
  AuthenticationRequiredError,
  requirePrincipal,
} from "./require-principal";

describe("requirePrincipal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an absent Auth.js database session", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(requirePrincipal()).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });

  it("rejects a session without a user id", async () => {
    mocks.auth.mockResolvedValue({ user: {} });

    await expect(requirePrincipal()).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });

  it("fails closed when the database-session suspension flag is missing", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-id" } });

    await expect(requirePrincipal()).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });

  it("rejects a suspended account even when the session remains present", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-id",
        name: "Suspended User",
        email: "suspended@example.com",
        image: null,
        isSuspended: true,
      },
    });

    await expect(requirePrincipal()).rejects.toBeInstanceOf(AccountSuspendedError);
  });

  it("returns only the current active user identity", async () => {
    mocks.auth.mockResolvedValue({
      user: {
        id: "user-id",
        name: "Active User",
        email: "active@example.com",
        image: "https://example.com/avatar.png",
        isSuspended: false,
        role: "untrusted-session-role",
      },
    });

    await expect(requirePrincipal()).resolves.toEqual({
      id: "user-id",
      name: "Active User",
      email: "active@example.com",
      image: "https://example.com/avatar.png",
    });
  });
});

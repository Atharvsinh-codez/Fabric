import { describe, expect, it, vi } from "vitest";

import { requestVerifiedGitHubProfile } from "./github-profile";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const profile = {
  id: 42,
  login: "fabric-user",
  name: "Fabric User",
  email: "untrusted-public@example.com",
  avatar_url: "https://avatars.githubusercontent.com/u/42",
};

describe("requestVerifiedGitHubProfile", () => {
  it("uses the verified primary email returned by GitHub's email endpoint", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = input.toString();
      if (url.endsWith("/user/emails")) {
        return jsonResponse([
          { email: "secondary@example.com", primary: false, verified: true },
          { email: "Primary@Example.COM", primary: true, verified: true },
        ]);
      }
      return jsonResponse(profile);
    });

    const result = await requestVerifiedGitHubProfile({
      accessToken: "short-lived-oauth-token",
      fetchImplementation,
    });

    expect(result.email).toBe("primary@example.com");
    expect(result.email_verified).toBe(true);
    expect(JSON.stringify(result)).not.toContain("short-lived-oauth-token");

    for (const [, init] of fetchImplementation.mock.calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer short-lived-oauth-token",
      );
    }
  });

  it("fails closed when GitHub has no verified email", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) =>
      input.toString().endsWith("/user/emails")
        ? jsonResponse([
            { email: "unverified@example.com", primary: true, verified: false },
          ])
        : jsonResponse(profile),
    );

    const result = await requestVerifiedGitHubProfile({
      accessToken: "short-lived-oauth-token",
      fetchImplementation,
    });

    expect(result.email).toBeNull();
    expect(result.email_verified).toBe(false);
  });

  it("returns only a generic failure when either GitHub endpoint fails", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) =>
      input.toString().endsWith("/user/emails")
        ? jsonResponse({ message: "provider details" }, 503)
        : jsonResponse(profile),
    );

    await expect(
      requestVerifiedGitHubProfile({
        accessToken: "short-lived-oauth-token",
        fetchImplementation,
      }),
    ).rejects.toThrow("GitHub profile request failed.");
  });
});

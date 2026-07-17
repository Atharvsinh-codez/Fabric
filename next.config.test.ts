import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("legacy application route redirects", () => {
  it("redirects old board and workspace deep links to canonical routes", async () => {
    expect(nextConfig.redirects).toBeTypeOf("function");
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual([
      {
        source: "/app/product-studio/boards/:boardId",
        destination: "/app/boards/:boardId",
        permanent: true,
      },
      {
        source: "/app/product-studio",
        destination: "/app/dashboard",
        permanent: true,
      },
      {
        source: "/app/product-studio/:path*",
        destination: "/app/dashboard/:path*",
        permanent: true,
      },
    ]);
  });
});

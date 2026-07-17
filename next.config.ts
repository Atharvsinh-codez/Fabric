import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

function realtimeConnectSource(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (!configuredUrl) return isDevelopment ? "ws://localhost:*" : null;

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

const realtimeSource = realtimeConnectSource();

function r2ConnectSources(): string[] {
  const accountId = process.env.FABRIC_R2_ACCOUNT_ID?.trim();
  const buckets = [
    process.env.FABRIC_R2_BOARD_ASSET_BUCKET,
    process.env.FABRIC_R2_AVATAR_BUCKET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (!accountId || !/^[a-f0-9]{32}$/i.test(accountId)) return [];

  const origins = new Set([`https://${accountId}.r2.cloudflarestorage.com`]);
  for (const bucket of buckets) {
    if (/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      origins.add(`https://${bucket}.${accountId}.r2.cloudflarestorage.com`);
    }
  }
  return [...origins];
}

const r2Sources = r2ConnectSources();

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  `connect-src 'self'${realtimeSource ? ` ${realtimeSource}` : ""}${
    r2Sources.length > 0 ? ` ${r2Sources.join(" ")}` : ""
  }`,
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'self' blob: data: https:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.ui.sh",
      },
    ],
  },
  async redirects() {
    return [
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
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [...securityHeaders],
      },
    ];
  },
};

export default nextConfig;

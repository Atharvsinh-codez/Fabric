import "server-only";

import { parseAuthEnvironment } from "@/lib/auth/environment-policy";
import { installCanonicalAuthOrigin } from "@/lib/auth/runtime-origin";

const runtimeEnvironment = installCanonicalAuthOrigin(process.env);

export const authEnvironment = parseAuthEnvironment({
  NODE_ENV: process.env.NODE_ENV,
  FABRIC_ENV: process.env.FABRIC_ENV,
  NEXT_PUBLIC_APP_URL: runtimeEnvironment.NEXT_PUBLIC_APP_URL,
  APP_URL: runtimeEnvironment.APP_URL,
  AUTH_URL: runtimeEnvironment.AUTH_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
  AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
  AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID,
  AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET,
  AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
  DATABASE_URL: process.env.DATABASE_URL,
});

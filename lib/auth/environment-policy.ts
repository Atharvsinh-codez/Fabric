import { z } from "zod";

const PLACEHOLDER_VALUE_PATTERN =
  /(?:replace[-_ ]?me|change[-_ ]?me|example|your[-_ ]|placeholder)/i;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const authEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    FABRIC_ENV: z.enum(["local", "preview", "staging", "production"]).default("local"),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    APP_URL: z.string().url().optional(),
    AUTH_URL: z.string().url().optional(),
    AUTH_SECRET: z.string().min(32),
    AUTH_GOOGLE_ID: z.string().min(1),
    AUTH_GOOGLE_SECRET: z.string().min(1),
    AUTH_GITHUB_ID: z.string().min(1),
    AUTH_GITHUB_SECRET: z.string().min(1),
    AUTH_TRUST_HOST: z.enum(["true", "false"]).optional(),
    DATABASE_URL: z.string().url(),
  })
  .superRefine((environment, context) => {
    if (environment.FABRIC_ENV !== "production") return;

    const canonicalUrls = [
      ["NEXT_PUBLIC_APP_URL", environment.NEXT_PUBLIC_APP_URL],
      ["APP_URL", environment.APP_URL],
      ["AUTH_URL", environment.AUTH_URL],
    ] as const;

    const canonicalOrigins = new Set<string>();
    for (const [key, value] of canonicalUrls) {
      if (!value) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required in production.`,
        });
        continue;
      }

      const url = new URL(value);
      const isCanonicalOrigin =
        url.protocol === "https:" &&
        !LOCAL_HOSTNAMES.has(url.hostname) &&
        !url.username &&
        !url.password &&
        (url.pathname === "/" || url.pathname === "") &&
        !url.search &&
        !url.hash;

      if (!isCanonicalOrigin) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must be a canonical public HTTPS origin in production.`,
        });
        continue;
      }

      canonicalOrigins.add(url.origin);
    }

    if (canonicalOrigins.size > 1) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_URL"],
        message: "AUTH_URL, APP_URL, and NEXT_PUBLIC_APP_URL must use the same origin.",
      });
    }

    const secrets = [
      ["AUTH_SECRET", environment.AUTH_SECRET],
      ["AUTH_GOOGLE_ID", environment.AUTH_GOOGLE_ID],
      ["AUTH_GOOGLE_SECRET", environment.AUTH_GOOGLE_SECRET],
      ["AUTH_GITHUB_ID", environment.AUTH_GITHUB_ID],
      ["AUTH_GITHUB_SECRET", environment.AUTH_GITHUB_SECRET],
    ] as const;

    for (const [key, value] of secrets) {
      if (PLACEHOLDER_VALUE_PATTERN.test(value)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} cannot use a placeholder value in production.`,
        });
      }
    }

    const databaseUrl = new URL(environment.DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
      !databaseUrl.hostname.includes("-pooler")
    ) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL must use a pooled Neon PostgreSQL hostname in production.",
      });
    }
  });

export type AuthEnvironment = Omit<
  z.infer<typeof authEnvironmentSchema>,
  "AUTH_TRUST_HOST"
> & {
  AUTH_TRUST_HOST: boolean;
};

export function parseAuthEnvironment(environment: Record<string, string | undefined>): AuthEnvironment {
  const parsed = authEnvironmentSchema.parse(environment);

  return {
    ...parsed,
    AUTH_TRUST_HOST: parsed.AUTH_TRUST_HOST === "true",
  };
}

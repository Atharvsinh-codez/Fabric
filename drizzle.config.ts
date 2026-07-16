import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

const migrationUrl = process.env.DATABASE_URL_DIRECT;

if (!migrationUrl) {
  throw new Error("DATABASE_URL_DIRECT is required for schema generation and migrations.");
}

if (migrationUrl.includes("-pooler")) {
  throw new Error("DATABASE_URL_DIRECT must use a direct Neon hostname, not a pooled runtime host.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/*.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: migrationUrl,
  },
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  strict: true,
  verbose: true,
});

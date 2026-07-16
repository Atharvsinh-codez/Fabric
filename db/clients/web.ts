import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as authSchema from "@/db/schema/auth";
import { authEnvironment } from "@/lib/auth/server-env";

const globalForDatabase = globalThis as typeof globalThis & {
  fabricWebSql?: ReturnType<typeof postgres>;
};

const client =
  globalForDatabase.fabricWebSql ??
  postgres(authEnvironment.DATABASE_URL, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 300,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.fabricWebSql = client;
}

export const db = drizzle({ client, schema: authSchema });

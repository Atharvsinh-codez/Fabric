import { readFile } from "node:fs/promises";
import path from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { avatarUploadReservations } from "@/db/schema/assets";

describe("R2 upload reservation safety", () => {
  it("enforces durable avatar intent, expiry, status, and user ownership", () => {
    const config = getTableConfig(avatarUploadReservations);
    expect(config.name).toBe("avatar_upload_reservations");
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "avatar_upload_reservations_mime_type_check",
        "avatar_upload_reservations_byte_size_check",
        "avatar_upload_reservations_content_hash_check",
        "avatar_upload_reservations_status_check",
        "avatar_upload_reservations_expiry_check",
        "avatar_upload_reservations_completion_check",
        "avatar_upload_reservations_r2_object_key_check",
      ]),
    );
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "avatar_upload_reservations_r2_object_key_unique",
        "avatar_upload_reservations_user_status_expiry_idx",
      ]),
    );
    expect(
      config.foreignKeys.map((foreignKey) => ({
        name: foreignKey.getName(),
        columns: foreignKey.reference().columns.map((column) => column.name),
        foreignColumns: foreignKey
          .reference()
          .foreignColumns.map((column) => column.name),
      })),
    ).toContainEqual({
      name: "avatar_upload_reservations_user_id_users_id_fk",
      columns: ["user_id"],
      foreignColumns: ["id"],
    });
  });

  it("ships a forward-only additive migration", async () => {
    const migration = await readFile(
      path.join(
        process.cwd(),
        "db",
        "migrations",
        "0010_heavy_boom_boom.sql",
      ),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "avatar_upload_reservations"');
    expect(migration).toContain(
      'CREATE INDEX "avatar_upload_reservations_user_status_expiry_idx"',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "avatar_upload_reservations_user_id_users_id_fk"',
    );
    expect(migration).not.toMatch(/\b(drop|truncate)\s+(table|column)\b/i);
  });

  it("enqueues expired board staging and orphaned final objects before marking grants expired", async () => {
    const repository = await readFile(
      path.join(
        process.cwd(),
        "lib",
        "boards",
        "assets",
        "r2-repository.ts",
      ),
      "utf8",
    );
    const reserve = repository.indexOf("async reserve(input)");
    const expiredSelection = repository.indexOf(
      "const expiredUploads = await transaction",
      reserve,
    );
    const cleanupEnqueue = repository.indexOf(
      ".insert(assetObjectDeletions)",
      expiredSelection,
    );
    const expiredState = repository.indexOf(
      '.set({ status: "expired", updatedAt: now })',
      cleanupEnqueue,
    );
    const orphanedPromotion = repository.indexOf(
      'reason: "upload_orphaned_promotion"',
      cleanupEnqueue,
    );

    expect(reserve).toBeGreaterThanOrEqual(0);
    expect(expiredSelection).toBeGreaterThan(reserve);
    expect(cleanupEnqueue).toBeGreaterThan(expiredSelection);
    expect(orphanedPromotion).toBeGreaterThan(cleanupEnqueue);
    expect(expiredState).toBeGreaterThan(orphanedPromotion);
  });

  it("reconciles expired avatar final objects during eager and scheduled cleanup", async () => {
    const [avatarRepository, cleanupRepository] = await Promise.all([
      readFile(
        path.join(process.cwd(), "lib", "account", "avatar-repository.ts"),
        "utf8",
      ),
      readFile(
        path.join(
          process.cwd(),
          "lib",
          "storage",
          "r2",
          "cleanup-repository.ts",
        ),
        "utf8",
      ),
    ]);

    expect(avatarRepository).toContain("avatarFinalObjectKey");
    expect(avatarRepository).toContain('reason: "avatar_orphaned_promotion"');
    expect(cleanupRepository).toContain("async expireAvatarUploads(input)");
    expect(cleanupRepository).toContain('reason: "avatar_orphaned_promotion"');
    expect(cleanupRepository).toContain('reason: "upload_orphaned_promotion"');
  });
});

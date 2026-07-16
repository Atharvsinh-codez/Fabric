"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/clients/web";
import { users } from "@/db/schema/auth";
import { requirePrincipal } from "@/lib/auth/require-principal";

const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Enter a display name.")
    .max(80, "Keep the display name under 80 characters."),
});

export type ProfileActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
}>;

export async function updateCurrentProfile(
  _previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const principal = await requirePrincipal();
  const parsed = profileSchema.safeParse({ displayName: formData.get("display-name") });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Check the profile details and try again.",
    };
  }

  await db
    .update(users)
    .set({ name: parsed.data.displayName, updatedAt: new Date() })
    .where(eq(users.id, principal.id));

  revalidatePath("/app", "layout");

  return { status: "success", message: "Profile saved." };
}

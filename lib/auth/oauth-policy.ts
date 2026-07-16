import type { AdapterAccount } from "next-auth/adapters";
import type { Profile } from "next-auth";
import { z } from "zod";

const oauthProviderSchema = z.enum(["google", "github"]);
const oauthEmailSchema = z.string().trim().email().transform((email) => email.toLowerCase());

export type FabricOAuthProvider = z.infer<typeof oauthProviderSchema>;

export function parseOAuthProvider(value: unknown): FabricOAuthProvider | null {
  const result = oauthProviderSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function canonicalizeOAuthEmail(value: unknown): string | null {
  const result = oauthEmailSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function getVerifiedProviderEmail(
  provider: FabricOAuthProvider,
  profile: Profile | undefined,
): string | null {
  if (profile?.email_verified !== true) return null;
  switch (provider) {
    case "google":
    case "github":
      return canonicalizeOAuthEmail(profile.email);
  }
}

export function hasVerifiedProviderEmail(
  provider: FabricOAuthProvider,
  profile: Profile | undefined,
): boolean {
  return getVerifiedProviderEmail(provider, profile) !== null;
}

export function redactIdentityOnlyTokens(account: AdapterAccount): AdapterAccount {
  return {
    ...account,
    access_token: undefined,
    refresh_token: undefined,
    id_token: undefined,
  };
}

import {
  canonicalizeOAuthEmail,
  parseOAuthProvider,
  type FabricOAuthProvider,
} from "./oauth-policy";

type OAuthSignInUser = Readonly<{
  emailVerified?: Date | null;
  suspendedAt?: Date | null;
}>;

export type OAuthEmailLinkCandidate = Readonly<{
  email: string | null;
  suspendedAt: Date | null;
  providers: readonly string[];
}>;

/**
 * Auth.js supplies a persisted adapter user when an account already exists and
 * a provider-profile user for first-time sign-ins. Persisted rows must include
 * Fabric's suspension field; missing policy data fails closed.
 */
export function isOAuthSignInUserAllowed(user: OAuthSignInUser): boolean {
  if (!("emailVerified" in user)) return true;
  if (!("suspendedAt" in user)) return false;
  return user.suspendedAt == null;
}

export function isVerifiedEmailAutoLinkAllowed(input: {
  incomingProvider: FabricOAuthProvider;
  verifiedEmail: string;
  incomingEmail: string | null | undefined;
  candidates: readonly OAuthEmailLinkCandidate[];
}): boolean {
  const verifiedEmail = canonicalizeOAuthEmail(input.verifiedEmail);
  const incomingEmail = canonicalizeOAuthEmail(input.incomingEmail);
  if (!verifiedEmail || incomingEmail !== verifiedEmail) return false;
  if (input.candidates.length === 0) return true;
  if (input.candidates.length !== 1) return false;

  const [candidate] = input.candidates;
  if (
    !candidate ||
    candidate.suspendedAt !== null ||
    canonicalizeOAuthEmail(candidate.email) !== verifiedEmail
  ) {
    return false;
  }
  const providers = candidate.providers
    .map((provider) => parseOAuthProvider(provider))
    .filter((provider): provider is FabricOAuthProvider => provider !== null);
  const oppositeProvider = input.incomingProvider === "google" ? "github" : "google";
  return (
    !providers.includes(input.incomingProvider) &&
    providers.includes(oppositeProvider)
  );
}

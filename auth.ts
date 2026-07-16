import "server-only";

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import { and, eq, lt, sql } from "drizzle-orm";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { db } from "@/db/clients/web";
import {
  accountSecurityEvents,
  accounts,
  sessionMetadata,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema/auth";
import {
  resolveUserAvatar,
  type UserAvatarProjection,
} from "@/lib/account/avatar-contracts";
import { authEnvironment } from "@/lib/auth/server-env";
import {
  isOAuthSignInUserAllowed,
  isVerifiedEmailAutoLinkAllowed,
  type OAuthEmailLinkCandidate,
} from "@/lib/auth/account-access";
import { requestVerifiedGitHubProfile } from "@/lib/auth/github-profile";
import {
  canonicalizeOAuthEmail,
  getVerifiedProviderEmail,
  parseOAuthProvider,
  redactIdentityOnlyTokens,
} from "@/lib/auth/oauth-policy";
import { safeAuthLogger } from "@/lib/auth/safe-logger";

const SESSION_LAST_SEEN_UPDATE_INTERVAL_MS = 15 * 60 * 1_000;
const MAX_TRACKED_SESSION_TOUCHES = 10_000;

type StoredAdapterSession = AdapterSession & { id?: string };
type StoredAdapterUser = AdapterUser &
  UserAvatarProjection & { suspendedAt?: Date | null };

const sessionLastSeenTouches = new Map<string, number>();

function rememberSessionTouch(sessionId: string, touchedAt: number): void {
  sessionLastSeenTouches.delete(sessionId);
  if (sessionLastSeenTouches.size >= MAX_TRACKED_SESSION_TOUCHES) {
    const oldestSessionId = sessionLastSeenTouches.keys().next().value;
    if (oldestSessionId) sessionLastSeenTouches.delete(oldestSessionId);
  }
  sessionLastSeenTouches.set(sessionId, touchedAt);
}

function touchSessionLastSeen(sessionId: string): void {
  const now = Date.now();
  const previousTouch = sessionLastSeenTouches.get(sessionId) ?? 0;
  if (now - previousTouch < SESSION_LAST_SEEN_UPDATE_INTERVAL_MS) return;
  rememberSessionTouch(sessionId, now);

  void db
    .update(sessionMetadata)
    .set({ lastSeenAt: new Date(now) })
    .where(
      and(
        eq(sessionMetadata.sessionId, sessionId),
        lt(
          sessionMetadata.lastSeenAt,
          new Date(now - SESSION_LAST_SEEN_UPDATE_INTERVAL_MS),
        ),
      ),
    )
    .catch(() => {
      if (sessionLastSeenTouches.get(sessionId) === now) {
        sessionLastSeenTouches.delete(sessionId);
      }
    });
}

async function findOAuthEmailLinkCandidates(
  verifiedEmail: string,
): Promise<OAuthEmailLinkCandidate[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      suspendedAt: users.suspendedAt,
      provider: accounts.provider,
    })
    .from(users)
    .leftJoin(accounts, eq(accounts.userId, users.id))
    .where(sql`lower(${users.email}) = ${verifiedEmail}`);
  const candidates = new Map<string, OAuthEmailLinkCandidate & { providers: string[] }>();
  for (const row of rows) {
    const candidate = candidates.get(row.userId) ?? {
      email: row.email,
      suspendedAt: row.suspendedAt,
      providers: [],
    };
    if (row.provider) candidate.providers.push(row.provider);
    candidates.set(row.userId, candidate);
  }
  return [...candidates.values()];
}

function createIdentityOnlyAdapter(): Adapter {
  const adapter = DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });
  const getSessionAndUser = adapter.getSessionAndUser;

  if (!getSessionAndUser) {
    throw new Error("The configured authentication adapter is missing required methods.");
  }

  return {
    ...adapter,
    async getUserByEmail(email) {
      const canonicalEmail = canonicalizeOAuthEmail(email);
      if (!canonicalEmail) return null;
      const matches = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${canonicalEmail}`)
        .limit(2);
      if (matches.length > 1) {
        throw new Error("The verified email resolves to more than one Fabric account.");
      }
      const match = matches[0];
      if (!match) return null;
      if (!match.email) {
        throw new Error("The Fabric account is missing its verified email.");
      }
      return match as StoredAdapterUser;
    },
    async linkAccount(account) {
      const redacted = redactIdentityOnlyTokens(account);
      await db.transaction(async (transaction) => {
        await transaction.insert(accounts).values({
          userId: redacted.userId,
          type: redacted.type,
          provider: redacted.provider,
          providerAccountId: redacted.providerAccountId,
          refresh_token: null,
          access_token: null,
          expires_at: redacted.expires_at,
          token_type: redacted.token_type,
          scope: redacted.scope,
          id_token: null,
          session_state:
            typeof redacted.session_state === "string"
              ? redacted.session_state
              : null,
        });
        await transaction.insert(accountSecurityEvents).values({
          userId: redacted.userId,
          eventType: "oauth_account_linked",
          provider: redacted.provider,
          details: { identityOnly: true },
        });
      });
    },
    async createSession(session) {
      const createdSession = await db.transaction(async (transaction) => {
        const [createdSession] = await transaction
          .insert(sessions)
          .values(session)
          .returning();

        if (!createdSession) {
          throw new Error("The authentication session could not be created.");
        }

        await transaction.insert(sessionMetadata).values({ sessionId: createdSession.id });
        return createdSession;
      });
      rememberSessionTouch(createdSession.id, Date.now());
      return createdSession;
    },
    async getSessionAndUser(sessionToken) {
      const result = await getSessionAndUser(sessionToken);
      const sessionId = (result?.session as StoredAdapterSession | undefined)?.id;

      if (result && sessionId) touchSessionLastSeen(sessionId);

      return result;
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createIdentityOnlyAdapter(),
  secret: authEnvironment.AUTH_SECRET,
  logger: safeAuthLogger,
  ...(authEnvironment.AUTH_TRUST_HOST ? { trustHost: true } : {}),
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  providers: [
    Google({
      clientId: authEnvironment.AUTH_GOOGLE_ID,
      clientSecret: authEnvironment.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        url: "https://accounts.google.com/o/oauth2/v2/auth",
        params: { scope: "openid email profile" },
      },
      token: "https://oauth2.googleapis.com/token",
      userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
    }),
    GitHub({
      clientId: authEnvironment.AUTH_GITHUB_ID,
      clientSecret: authEnvironment.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true,
      authorization: { params: { scope: "read:user user:email" } },
      userinfo: {
        url: "https://api.github.com/user",
        request: ({ tokens }: { tokens: { access_token?: string } }) =>
          requestVerifiedGitHubProfile({ accessToken: tokens.access_token }),
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login/error",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) return false;
      const provider = parseOAuthProvider(account?.provider);
      if (!provider) return false;
      const verifiedEmail = getVerifiedProviderEmail(provider, profile);
      if (!verifiedEmail) return false;

      const storedUser = user as StoredAdapterUser;
      if ("emailVerified" in storedUser) {
        return isOAuthSignInUserAllowed(storedUser);
      }
      return isVerifiedEmailAutoLinkAllowed({
        incomingProvider: provider,
        verifiedEmail,
        incomingEmail: user.email,
        candidates: await findOAuthEmailLinkCandidates(verifiedEmail),
      });
    },
    session({ session, user }) {
      const storedUser = user as StoredAdapterUser;
      const sessionUser = session.user as typeof session.user & {
        isSuspended: boolean;
      };
      sessionUser.id = user.id;
      sessionUser.image = resolveUserAvatar(storedUser).image;
      sessionUser.isSuspended = Boolean(storedUser.suspendedAt);
      return session;
    },
  },
});

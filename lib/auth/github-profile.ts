import { z } from "zod";

import { canonicalizeOAuthEmail } from "./oauth-policy";

const githubProfileSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    login: z.string().min(1),
    name: z.string().nullable().optional(),
    avatar_url: z.string().nullable().optional(),
  })
  .passthrough();

const githubEmailsSchema = z.array(
  z.object({
    email: z.string().email(),
    primary: z.boolean(),
    verified: z.boolean(),
  }),
);

type GitHubProfileRequest = Readonly<{
  accessToken: string | undefined;
  fetchImplementation?: typeof fetch;
}>;

const GITHUB_PROFILE_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

function githubHeaders(accessToken: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "fabric-auth",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function parseSuccessfulJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error("GitHub profile request failed.");
  }

  try {
    return await response.json();
  } catch {
    throw new Error("GitHub profile request failed.");
  }
}

export async function requestVerifiedGitHubProfile({
  accessToken,
  fetchImplementation = fetch,
}: GitHubProfileRequest): Promise<Record<string, unknown>> {
  if (!accessToken) {
    throw new Error("GitHub profile request failed.");
  }

  const headers = githubHeaders(accessToken);
  const [profileResponse, emailsResponse] = await Promise.all([
    fetchImplementation(GITHUB_PROFILE_URL, { headers }),
    fetchImplementation(GITHUB_EMAILS_URL, { headers }),
  ]);
  const [profileJson, emailsJson] = await Promise.all([
    parseSuccessfulJson(profileResponse),
    parseSuccessfulJson(emailsResponse),
  ]);

  const profileResult = githubProfileSchema.safeParse(profileJson);
  const emailsResult = githubEmailsSchema.safeParse(emailsJson);
  if (!profileResult.success || !emailsResult.success) {
    throw new Error("GitHub profile request failed.");
  }

  const profile = profileResult.data;
  const emails = emailsResult.data;
  const verifiedEmail =
    emails.find((email) => email.primary && email.verified) ??
    emails.find((email) => email.verified);

  return {
    ...profile,
    email: canonicalizeOAuthEmail(verifiedEmail?.email),
    email_verified: Boolean(verifiedEmail),
  };
}

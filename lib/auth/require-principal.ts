import "server-only";

import { auth } from "@/auth";

export type Principal = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export class AuthenticationRequiredError extends Error {
  readonly status = 401;

  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class AccountSuspendedError extends Error {
  readonly status = 403;

  constructor() {
    super("This account cannot access protected resources.");
    this.name = "AccountSuspendedError";
  }
}

export async function requirePrincipal(): Promise<Principal> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new AuthenticationRequiredError();
  }

  const sessionUser = session.user as typeof session.user & {
    id: string;
    isSuspended?: boolean;
  };

  if (typeof sessionUser.isSuspended !== "boolean") {
    throw new AuthenticationRequiredError();
  }

  if (sessionUser.isSuspended) {
    throw new AccountSuspendedError();
  }

  return {
    id: sessionUser.id,
    name: sessionUser.name,
    email: sessionUser.email,
    image: sessionUser.image,
  };
}

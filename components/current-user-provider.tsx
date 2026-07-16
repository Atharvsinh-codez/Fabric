"use client";

import { createContext, useContext, type ReactNode } from "react";

export type CurrentUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}>;

const CurrentUserContext = createContext<CurrentUser | null>(null);

export function CurrentUserProvider({
  user,
  children,
}: {
  user: CurrentUser;
  children: ReactNode;
}) {
  return <CurrentUserContext value={user}>{children}</CurrentUserContext>;
}

export function useCurrentUser(): CurrentUser {
  const user = useContext(CurrentUserContext);

  if (!user) {
    throw new Error("useCurrentUser must be used within CurrentUserProvider");
  }

  return user;
}

export function getUserInitials(user: Pick<CurrentUser, "name" | "email">): string {
  const nameParts = user.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (nameParts.length > 0) {
    return nameParts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  return user.email?.trim().charAt(0).toUpperCase() || "F";
}

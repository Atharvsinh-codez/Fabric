"use client";

import { useActionState, useEffect, useState } from "react";
import DoorOutIcon from "reicon-react/icons/ArrowDoorOut3";
import CheckIcon from "reicon-react/icons/CheckCircle";
import DeviceIcon from "reicon-react/icons/Laptop";
import RefreshIcon from "reicon-react/icons/Refresh";
import ShieldIcon from "reicon-react/icons/ShieldCheck";
import TrashIcon from "reicon-react/icons/Trash2";

import {
  updateCurrentProfile,
  type ProfileActionState,
} from "@/app/actions/account";
import { signOutCurrentSession } from "@/app/actions/auth";
import { useCurrentUser } from "@/components/current-user-provider";
import { Button, UserAvatar, cx } from "@/components/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import {
  listAccountSessions,
  revokeAccountSession,
  type AccountSession,
} from "@/lib/account/client";
import {
  loadAccountAvatar,
  removeAccountAvatar,
  uploadAccountAvatar,
} from "@/lib/account/avatar-client";

const initialProfileActionState = {
  status: "idle",
  message: "",
} satisfies ProfileActionState;

const fieldClass =
  "h-11 w-full rounded-radius-md bg-surface-white px-3 text-base text-near-black-primary-text ring-1 ring-near-black-primary-text/10 outline-none placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm";

const sessionDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function AccountPage({
  customAvatarEnabled,
}: {
  customAvatarEnabled: boolean;
}) {
  const user = useCurrentUser();
  const [profileState, profileAction, profilePending] = useActionState(
    updateCurrentProfile,
    initialProfileActionState,
  );
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsState, setSessionsState] = useState<"loading" | "ready" | "error">("loading");
  const [sessionsError, setSessionsError] = useState("");
  const [sessionsRequestVersion, setSessionsRequestVersion] = useState(0);
  const [currentSessionVerified, setCurrentSessionVerified] = useState(false);
  const [sessionToRevoke, setSessionToRevoke] = useState<AccountSession | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [sessionAnnouncement, setSessionAnnouncement] = useState("");
  const [avatarImage, setAvatarImage] = useState(user.image ?? null);
  const [avatarSource, setAvatarSource] = useState<"custom" | "oauth" | "initials">(
    user.image?.startsWith("/api/users/") ? "custom" : user.image ? "oauth" : "initials",
  );
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadAccountAvatar(controller.signal)
      .then((avatar) => {
        setAvatarImage(avatar.image);
        setAvatarSource(avatar.source);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const changeAvatar = async (file: File) => {
    setAvatarBusy(true);
    setAvatarMessage("");
    try {
      const avatar = await uploadAccountAvatar(file);
      setAvatarImage(avatar.image);
      setAvatarSource(avatar.source);
      setAvatarMessage("Custom avatar updated.");
    } catch (error) {
      setAvatarMessage(error instanceof Error ? error.message : "Avatar could not be updated.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    setAvatarMessage("");
    try {
      const avatar = await removeAccountAvatar();
      setAvatarImage(avatar.image);
      setAvatarSource(avatar.source);
      setAvatarMessage(
        avatar.source === "oauth" ? "Using your provider avatar." : "Using your initials.",
      );
    } catch (error) {
      setAvatarMessage(error instanceof Error ? error.message : "Avatar could not be removed.");
    } finally {
      setAvatarBusy(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();

    void listAccountSessions(controller.signal)
      .then((result) => {
        setSessions(result.sessions);
        setCurrentSessionVerified(result.currentSessionVerified);
        setSessionsState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSessionsError(
          error instanceof Error
            ? error.message
            : "Sessions could not be loaded. Refresh the page and try again.",
        );
        setSessionsState("error");
      });

    return () => controller.abort();
  }, [sessionsRequestVersion]);

  const revokeSession = async (session: AccountSession) => {
    setRevokingSessionId(session.id);
    setSessionsError("");

    try {
      await revokeAccountSession(session.id);
      setSessions((current) => current.filter((candidate) => candidate.id !== session.id));
      setSessionToRevoke(null);
      setSessionAnnouncement(`${session.deviceLabel} session revoked`);
    } catch (error) {
      setSessionsError(
        error instanceof Error
          ? error.message
          : "The session was not revoked. Refresh the list and try again.",
      );
    } finally {
      setRevokingSessionId(null);
    }
  };

  return (
    <WorkspaceShell
      eyebrow="Personal workspace"
      title="Profile & access"
      description="Manage how you appear in Fabric and review the browsers connected to your account."
      action={
        <Button
          type="submit"
          form="account-settings"
          tone="primary"
          size="default"
          disabled={profilePending}
          className="w-full sm:w-auto"
        >
          {profilePending ? "Saving..." : "Save Profile"}
        </Button>
      }
    >
      {profileState.status !== "idle" && (
        <div
          role="status"
          className={cx(
            "flex items-start gap-2 rounded-radius-lg px-3 py-2 text-base ring-1 sm:text-sm",
            profileState.status === "success"
              ? "bg-(--success-soft) text-(--success) ring-(--success)/15"
              : "bg-(--danger-soft) text-(--danger) ring-(--danger-border)",
          )}
        >
          {profileState.status === "success" && (
            <CheckIcon size={16} className="h-lh shrink-0" aria-hidden="true" focusable="false" />
          )}
          <p>{profileState.message}</p>
        </div>
      )}

      <form id="account-settings" action={profileAction}>
        <section aria-labelledby="profile-heading" className="overflow-hidden rounded-radius-2xl bg-surface-white ring-1 ring-near-black-primary-text/7 soft-shadow">
          <div className="relative overflow-hidden bg-linear-to-br from-[#dff3ff] via-[#f4fbff] to-[#eef8f1] px-5 py-6 sm:px-7 sm:py-7">
            <div className="pointer-events-none absolute -top-12 right-8 size-36 rounded-full bg-white/55 blur-2xl" aria-hidden="true" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
              <UserAvatar
                user={{ ...user, image: avatarImage }}
                size="large"
                className="ring-4 ring-white/75"
              />
              <div className="min-w-0 flex-1">
                <h2 id="profile-heading" className="truncate text-xl font-medium tracking-tight">
                  {user.name || "Fabric member"}
                </h2>
                <p className="truncate text-base text-[var(--text-2)] sm:text-sm">
                  {user.email || "Connected account"}
                </p>
                <p className="pt-2 text-base text-muted-gray sm:text-sm">
                  {customAvatarEnabled
                    ? "A custom avatar overrides your provider image; removing it restores the provider image or initials."
                    : avatarSource === "custom"
                      ? "Your existing custom avatar remains active. You can remove it at any time."
                      : "Your provider image or initials are used for this workspace."}
                </p>
                {customAvatarEnabled ? (
                  <div className="flex flex-wrap items-center gap-2 pt-3">
                    <label className="inline-flex h-8 cursor-pointer items-center rounded-radius-md bg-surface-white px-2.5 text-sm font-medium text-near-black-primary-text ring-1 ring-border-subtle hover:bg-light-surface-tint">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        disabled={avatarBusy}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void changeAvatar(file);
                        }}
                      />
                      {avatarBusy ? "Updating..." : "Upload avatar"}
                    </label>
                    {avatarSource === "custom" && (
                      <Button type="button" tone="ghost" disabled={avatarBusy} onClick={() => void removeAvatar()}>
                        Use provider avatar
                      </Button>
                    )}
                  </div>
                ) : avatarSource === "custom" ? (
                  <div className="pt-3">
                    <Button
                      type="button"
                      tone="ghost"
                      disabled={avatarBusy}
                      onClick={() => void removeAvatar()}
                    >
                      {avatarBusy ? "Updating..." : "Use provider avatar"}
                    </Button>
                  </div>
                ) : null}
                {avatarMessage && (
                  <p role="status" className="pt-2 text-sm text-[var(--text-2)]">
                    {avatarMessage}
                  </p>
                )}
              </div>
              <p className="self-start rounded-radius-pill bg-surface-white/76 px-2.5 py-1 text-sm font-medium text-sky-blue-accent ring-1 ring-sky-blue-accent/12 sm:self-center">
                Connected
              </p>
            </div>
          </div>

          <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-7">
            <label htmlFor="account-name" className="flex flex-col gap-2 text-base font-medium sm:text-sm">
              <span>Display Name</span>
              <input
                id="account-name"
                name="display-name"
                defaultValue={user.name ?? ""}
                autoComplete="name"
                className={fieldClass}
              />
              <span className="font-normal text-muted-gray">
                Shown beside comments and live presence.
              </span>
            </label>
            <label htmlFor="account-email" className="flex flex-col gap-2 text-base font-medium sm:text-sm">
              <span>Email Address</span>
              <input
                id="account-email"
                name="email"
                type="email"
                value={user.email ?? ""}
                readOnly
                aria-describedby="account-email-description"
                className={cx(fieldClass, "bg-light-surface-tint text-[var(--text-2)]")}
              />
              <span id="account-email-description" className="font-normal text-muted-gray">
                Managed by your connected sign-in provider.
              </span>
            </label>
          </div>
        </section>
      </form>

      <section aria-labelledby="sessions-heading" className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ShieldIcon size={16} color="var(--color-sky-blue-accent)" className="h-lh shrink-0" aria-hidden="true" focusable="false" />
            <h2 id="sessions-heading" className="text-base font-semibold">Signed-in Browsers</h2>
          </div>
          <p className="max-w-[38ch] text-pretty text-base text-[var(--text-2)] sm:text-sm">
            Review active sessions and remove access you no longer recognize.
          </p>
        </div>

        <div className="min-w-0" aria-live="polite">
          <p className="sr-only">{sessionAnnouncement}</p>

          {sessionsState === "loading" && (
            <div className="flex items-center gap-3 rounded-radius-xl bg-surface-white px-4 py-5 ring-1 ring-near-black-primary-text/7">
              <span className="spinner text-sky-blue-accent" aria-hidden="true" />
              <p className="text-base text-[var(--text-2)] sm:text-sm">Loading sessions...</p>
            </div>
          )}

          {sessionsState === "error" && (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-radius-xl bg-(--danger-soft) px-4 py-4 ring-1 ring-(--danger-border)">
              <p className="text-pretty text-base text-(--danger) sm:text-sm">{sessionsError}</p>
              <Button
                tone="secondary"
                leading={<RefreshIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />}
                onClick={() => {
                  setSessionsState("loading");
                  setSessionsError("");
                  setSessionsRequestVersion((version) => version + 1);
                }}
              >
                Retry Sessions
              </Button>
            </div>
          )}

          {sessionsState === "ready" && sessions.length === 0 && (
            <div className="rounded-radius-xl bg-surface-white px-4 py-5 ring-1 ring-near-black-primary-text/7">
              <p className="text-pretty text-base text-[var(--text-2)] sm:text-sm">
                No active sessions were returned. Sign out and sign in again to create a fresh session.
              </p>
            </div>
          )}

          {sessionsState === "ready" && sessions.length > 0 && (
            <div className="overflow-hidden rounded-radius-2xl bg-surface-white ring-1 ring-near-black-primary-text/7 soft-shadow">
              {!currentSessionVerified && (
                <div role="alert" className="border-b border-(--danger-border) bg-(--danger-soft) px-4 py-3">
                  <p className="text-pretty text-base text-(--danger) sm:text-sm">
                    This browser could not be verified. Sign out and back in before revoking another session.
                  </p>
                </div>
              )}

              {sessionsError && (
                <div role="alert" className="border-b border-(--danger-border) bg-(--danger-soft) px-4 py-3">
                  <p className="text-pretty text-base text-(--danger) sm:text-sm">{sessionsError}</p>
                </div>
              )}

              <ul role="list" className="divide-y divide-near-black-primary-text/8">
                {sessions.map((session) => {
                  const activityDate = session.lastSeenAt ?? session.createdAt;
                  const confirmationOpen = sessionToRevoke?.id === session.id;
                  const revoking = revokingSessionId === session.id;

                  return (
                    <li key={session.id} className="p-4 sm:px-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                        <div className="flex min-w-0 items-start gap-3">
                          <DeviceIcon size={16} color="var(--color-sky-blue-accent)" className="mt-0.5 shrink-0" aria-hidden="true" focusable="false" />
                          <div className="min-w-0">
                            <p className="truncate text-base font-medium sm:text-sm">{session.deviceLabel}</p>
                            <p className="text-pretty text-base text-[var(--text-2)] sm:text-sm">
                              {activityDate
                                ? `Last active ${sessionDateFormatter.format(new Date(activityDate))}`
                                : `Expires ${sessionDateFormatter.format(new Date(session.expiresAt))}`}
                            </p>
                            {activityDate && (
                              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                                Expires {sessionDateFormatter.format(new Date(session.expiresAt))}
                              </p>
                            )}
                          </div>
                        </div>

                        {session.current ? (
                          <p className="shrink-0 rounded-radius-pill bg-(--success-soft) px-2 py-1 text-sm font-medium text-(--success)">
                            Current Browser
                          </p>
                        ) : (
                          <Button
                            tone="ghost"
                            leading={<TrashIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />}
                            disabled={!currentSessionVerified || revokingSessionId !== null}
                            aria-expanded={confirmationOpen}
                            aria-controls={confirmationOpen ? `revoke-session-${session.id}` : undefined}
                            onClick={() => {
                              setSessionsError("");
                              setSessionToRevoke(session);
                            }}
                          >
                            Revoke Session
                          </Button>
                        )}
                      </div>

                      {confirmationOpen && (
                        <div id={`revoke-session-${session.id}`} className="pt-3">
                          <div className="rounded-radius-lg bg-light-surface-tint p-3 ring-1 ring-near-black-primary-text/7">
                            <p className="text-base font-medium sm:text-sm">Revoke This Session?</p>
                            <p className="max-w-[62ch] text-pretty text-base text-[var(--text-2)] sm:text-sm">
                              {session.deviceLabel} will lose access immediately. The person using it must sign in again.
                            </p>
                            <div className="flex flex-wrap gap-2 pt-3">
                              <Button tone="secondary" disabled={revoking} onClick={() => setSessionToRevoke(null)}>
                                Keep Session
                              </Button>
                              <Button tone="danger" disabled={revoking} onClick={() => void revokeSession(session)}>
                                {revoking ? "Revoking..." : "Revoke Session"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="sign-out-heading" className="flex flex-col gap-4 border-t border-near-black-primary-text/8 pt-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <DoorOutIcon size={16} color="var(--color-muted-gray)" className="mt-0.5 shrink-0" aria-hidden="true" focusable="false" />
          <div>
            <h2 id="sign-out-heading" className="text-base font-semibold">Sign Out</h2>
            <p className="max-w-[58ch] text-pretty text-base text-[var(--text-2)] sm:text-sm">
              Previously opened boards may retain local offline data on this device.
            </p>
          </div>
        </div>
        <form action={signOutCurrentSession}>
          <Button type="submit" tone="secondary" size="default" className="w-full sm:w-auto">
            Sign Out
          </Button>
        </form>
      </section>
    </WorkspaceShell>
  );
}

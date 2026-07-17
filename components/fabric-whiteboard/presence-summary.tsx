"use client";

import {
  ChevronDownIcon,
  UserGroupIcon,
} from "@heroicons/react/16/solid";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  getUserInitials,
  useCurrentUser,
} from "@/components/current-user-provider";
import {
  listWorkspaceMembers,
  type WorkspaceMember,
} from "@/lib/boards/client";
import type { RealtimeAwarenessState } from "@/lib/realtime/client/types";
import {
  authoritativePresenceColor,
  resolvePresencePresentation,
} from "@/lib/realtime/presence-identity";

type RemotePresencePerson = Readonly<{
  key: string;
  principalId: string | null;
  label: string;
  initials: string;
  color: string;
}>;

type DirectoryState = "idle" | "loading" | "loaded" | "failed";

export function remotePresenceEntries(
  awarenessStates: ReadonlyMap<number, RealtimeAwarenessState>,
  localAwarenessClientId: number | null,
) {
  return [...awarenessStates.entries()].filter(
    ([clientId]) => clientId !== localAwarenessClientId,
  );
}

function remotePresencePeople(
  awarenessStates: ReadonlyMap<number, RealtimeAwarenessState>,
  localAwarenessClientId: number | null,
  localPrincipalId: string,
): RemotePresencePerson[] {
  const people: RemotePresencePerson[] = [];
  const seenPrincipalIds = new Set<string>();

  for (const [clientId, state] of remotePresenceEntries(
    awarenessStates,
    localAwarenessClientId,
  )) {
    const presence = resolvePresencePresentation(state);
    const principalId = presence.authoritative && state.principalId
      ? state.principalId
      : null;
    if (principalId === localPrincipalId) continue;
    if (principalId && seenPrincipalIds.has(principalId)) continue;
    if (principalId) seenPrincipalIds.add(principalId);

    people.push({
      key: principalId ?? `client-${clientId}`,
      principalId,
      label: presence.label,
      initials: presence.initials,
      color: presence.color,
    });
  }

  return people;
}

function remoteEmailLabel(
  person: RemotePresencePerson,
  membersById: ReadonlyMap<string, WorkspaceMember>,
  directoryState: DirectoryState,
): string {
  if (!person.principalId) return "Identity unavailable";
  const email = membersById.get(person.principalId)?.email?.trim();
  if (email) return email;
  if (directoryState === "loading" || directoryState === "idle") {
    return "Loading email…";
  }
  return directoryState === "failed" ? "Email unavailable" : "Email hidden";
}

export function PresenceSummary({
  workspaceId,
  awarenessStates,
  localAwarenessClientId,
}: {
  workspaceId: string;
  awarenessStates: ReadonlyMap<number, RealtimeAwarenessState>;
  localAwarenessClientId: number | null;
}) {
  const currentUser = useCurrentUser();
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const loadedWorkspaceRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [directoryState, setDirectoryState] =
    useState<DirectoryState>("idle");
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const remotePeople = useMemo(
    () => remotePresencePeople(
      awarenessStates,
      localAwarenessClientId,
      currentUser.id,
    ),
    [awarenessStates, currentUser.id, localAwarenessClientId],
  );
  const membersById = useMemo(
    () => new Map(workspaceMembers.map((member) => [member.userId, member])),
    [workspaceMembers],
  );

  useEffect(() => {
    if (
      !open ||
      remotePeople.length === 0 ||
      loadedWorkspaceRef.current === workspaceId
    ) return;
    let current = true;
    setDirectoryState("loading");
    void listWorkspaceMembers(workspaceId)
      .then((members) => {
        if (!current) return;
        loadedWorkspaceRef.current = workspaceId;
        setWorkspaceMembers(members);
        setDirectoryState("loaded");
      })
      .catch(() => {
        if (!current) return;
        setDirectoryState("failed");
      });
    return () => {
      current = false;
    };
  }, [open, remotePeople.length, workspaceId]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const onlineCount = remotePeople.length + 1;
  const localLabel =
    currentUser.name?.trim() || currentUser.email?.trim() || "Fabric member";
  const localEmail = currentUser.email?.trim() || "Email unavailable";
  const visibleAvatars = [
    {
      key: `local-${currentUser.id}`,
      initials: getUserInitials(currentUser),
      color: authoritativePresenceColor(currentUser.id),
    },
    ...remotePeople,
  ].slice(0, 3);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="relative flex h-8 items-center gap-1 rounded-radius-md px-1 outline-none hover:bg-light-surface-tint active:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:gap-2 sm:pr-2"
        aria-label={`${onlineCount} ${onlineCount === 1 ? "collaborator" : "collaborators"} online. Show people`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex -space-x-1.5 max-sm:hidden" aria-hidden="true">
          {visibleAvatars.map((person) => (
            <span
              key={person.key}
              className="grid size-6 shrink-0 place-items-center rounded-radius-pill text-[0.625rem] font-medium text-white ring-2 ring-surface-white outline-1 -outline-offset-1 outline-black/10"
              style={{ backgroundColor: person.color }}
            >
              {person.initials}
            </span>
          ))}
        </span>
        <UserGroupIcon
          className="size-4 h-lh shrink-0 fill-muted-gray sm:hidden"
          aria-hidden="true"
        />
        <span className="flex items-center gap-1">
          <span className="min-w-5 text-center text-base font-medium text-muted-gray tabular-nums sm:min-w-0 sm:text-sm">
            <span className="sm:hidden">{onlineCount}</span>
            <span className="max-sm:hidden">{onlineCount} online</span>
          </span>
          <ChevronDownIcon
            className={`size-4 h-lh shrink-0 fill-muted-gray transition-transform duration-150 ease-out motion-reduce:transition-none max-sm:hidden ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </span>
        <span
          className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
          aria-hidden="true"
        />
      </button>

      {open ? (
        <section
          id={panelId}
          aria-label="People online"
          className="panel-enter absolute right-0 top-10 z-1100 w-[min(calc(100vw_-_1rem),20rem)] overflow-hidden rounded-radius-lg bg-surface-white shadow-xl ring-1 ring-black/5 motion-reduce:animate-none"
        >
          <header className="flex items-start justify-between gap-3 px-3.5 py-3">
            <div className="min-w-0">
              <h2 className="font-medium text-near-black-primary-text">People Online</h2>
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                {onlineCount} {onlineCount === 1 ? "person is" : "people are"} on this board.
              </p>
            </div>
            <p className="shrink-0 text-base font-medium text-sky-blue-accent tabular-nums sm:text-sm">
              {onlineCount}
            </p>
          </header>

          <ul
            role="list"
            className="max-h-[min(22rem,calc(100dvh_-_7rem))] overflow-y-auto border-t border-near-black-primary-text/10 px-2 py-1"
          >
            <li className="flex min-w-0 items-start gap-2.5 rounded-radius-md px-1.5 py-2.5">
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-radius-pill text-sm font-medium text-white outline-1 -outline-offset-1 outline-black/10"
                style={{ backgroundColor: authoritativePresenceColor(currentUser.id) }}
              >
                {getUserInitials(currentUser)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-near-black-primary-text sm:text-sm">
                  {localLabel} <span className="font-normal text-muted-gray">(You)</span>
                </p>
                <p className="truncate text-base text-muted-gray sm:text-sm" title={localEmail}>
                  {localEmail}
                </p>
              </div>
            </li>

            {remotePeople.map((person) => {
              const email = remoteEmailLabel(person, membersById, directoryState);
              return (
                <li
                  key={person.key}
                  className="flex min-w-0 items-start gap-2.5 rounded-radius-md px-1.5 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-radius-pill text-sm font-medium text-white outline-1 -outline-offset-1 outline-black/10"
                    style={{ backgroundColor: person.color }}
                  >
                    {person.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-near-black-primary-text sm:text-sm">
                      {person.label}
                    </p>
                    <p className="truncate text-base text-muted-gray sm:text-sm" title={email}>
                      {email}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

"use client";

import { UserGroupIcon } from "@heroicons/react/16/solid";

import type { RealtimeAwarenessState } from "@/lib/realtime/client/types";
import { resolvePresencePresentation } from "@/lib/realtime/presence-identity";

export function remotePresenceEntries(
  awarenessStates: ReadonlyMap<number, RealtimeAwarenessState>,
  localAwarenessClientId: number | null,
) {
  return [...awarenessStates.entries()].filter(
    ([clientId]) => clientId !== localAwarenessClientId,
  );
}

export function PresenceSummary({
  awarenessStates,
  localAwarenessClientId,
}: {
  awarenessStates: ReadonlyMap<number, RealtimeAwarenessState>;
  localAwarenessClientId: number | null;
}) {
  const remoteEntries = remotePresenceEntries(
    awarenessStates,
    localAwarenessClientId,
  );
  if (remoteEntries.length === 0) return null;

  // Remote awareness omits the person using this tab. Once another person is
  // present, include the local editor so the visible total answers “how many
  // people are on this board?” rather than only counting everyone else.
  const onlineCount = remoteEntries.length + 1;

  return (
    <div
      className="flex h-8 items-center px-1 sm:pr-2"
      aria-label={`${onlineCount} collaborators online`}
      aria-live="polite"
    >
      <div className="hidden -space-x-1.5 sm:flex" aria-hidden="true">
        {remoteEntries.slice(0, 3).map(([clientId, state]) => {
          const presence = resolvePresencePresentation(state);
          return (
            <div
              key={clientId}
              className="grid size-6 place-items-center rounded-full border-2 border-surface-white text-[0.625rem] font-semibold text-white"
              style={{ backgroundColor: presence.color }}
            >
              {presence.initials}
            </div>
          );
        })}
      </div>
      <UserGroupIcon
        className="size-4 h-lh shrink-0 fill-muted-gray sm:hidden"
        aria-hidden="true"
      />
      <p className="min-w-5 text-center text-base font-medium text-muted-gray sm:ml-2 sm:min-w-0 sm:text-sm">
        <span className="sm:hidden">{onlineCount}</span>
        <span className="max-sm:hidden">{onlineCount} online</span>
      </p>
    </div>
  );
}

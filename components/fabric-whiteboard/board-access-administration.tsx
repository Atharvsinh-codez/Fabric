"use client";

import { ChevronDownIcon, UserPlusIcon } from "@heroicons/react/16/solid";
import { useEffect, useState, type FormEvent } from "react";

import { useCurrentUser } from "@/components/current-user-provider";
import { Button, UserAvatar, cx } from "@/components/ui";
import type { BoardAccessRole, BoardSharingPolicy } from "@/db/schema/product";
import {
  addBoardMember,
  FabricApiError,
  listBoardMembers,
  listProjects,
  listWorkspaceMembers,
  removeBoardMember,
  updateBoardMember,
  updateBoardMetadata,
  type BoardMember,
  type ProjectSummary,
  type WorkspaceMember,
} from "@/lib/boards/client";

const accessRoles = ["editor", "commenter", "viewer"] as const satisfies readonly BoardAccessRole[];
const sharingPolicies = ["private", "project", "workspace"] as const satisfies readonly BoardSharingPolicy[];

const inputClass =
  "h-10 w-full rounded-radius-md bg-surface-white px-3 text-base text-near-black-primary-text outline-none ring-1 ring-border-subtle placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm";

const selectClass =
  "col-span-full row-start-1 h-10 w-full appearance-none rounded-radius-md bg-surface-white pr-8 pl-3 text-base font-normal text-near-black-primary-text outline-none ring-1 ring-border-subtle focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent disabled:bg-light-surface-tint disabled:text-muted-gray sm:h-9 sm:text-sm";

function safeError(error: unknown, fallback: string): string {
  return error instanceof FabricApiError && error.message ? error.message : fallback;
}

function accessRoleLabel(role: BoardAccessRole): string {
  if (role === "editor") return "Can Edit";
  if (role === "commenter") return "Can Comment";
  return "Can View";
}

function sharingPolicyLabel(policy: BoardSharingPolicy): string {
  if (policy === "private") return "Private";
  if (policy === "project") return "Project Members";
  return "Workspace Members";
}

function memberLabel(member: Pick<BoardMember | WorkspaceMember, "name">): string {
  return member.name?.trim() || "Workspace Member";
}

export function BoardAccessAdministration({
  boardId,
  workspaceId,
  initialOwnerId,
  initialProjectId,
  initialSharingPolicy,
  onBoardAccessChanged,
  onManagementLost,
}: {
  boardId: string;
  workspaceId: string;
  initialOwnerId: string;
  initialProjectId: string;
  initialSharingPolicy: BoardSharingPolicy;
  onBoardAccessChanged: () => void | Promise<unknown>;
  onManagementLost: () => void;
}) {
  const currentUser = useCurrentUser();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [requestVersion, setRequestVersion] = useState(0);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [ownerId, setOwnerId] = useState(initialOwnerId);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [sharingPolicy, setSharingPolicy] = useState(initialSharingPolicy);
  const [savedProjectId, setSavedProjectId] = useState(initialProjectId);
  const [savedSharingPolicy, setSavedSharingPolicy] = useState(initialSharingPolicy);
  const [transferTargetId, setTransferTargetId] = useState(initialOwnerId);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [pendingAction, setPendingAction] = useState<"organization" | "transfer" | "add-member" | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<BoardAccessRole>("viewer");

  useEffect(() => {
    let current = true;

    void Promise.all([
      listProjects(workspaceId),
      listWorkspaceMembers(workspaceId),
      listBoardMembers(boardId),
    ])
      .then(([nextProjects, nextWorkspaceMembers, nextBoardMembers]) => {
        if (!current) return;
        setProjects(nextProjects);
        setWorkspaceMembers(nextWorkspaceMembers);
        setBoardMembers(nextBoardMembers);
        setLoadState("ready");
      })
      .catch((caught: unknown) => {
        if (!current) return;
        setError(safeError(caught, "Board access settings could not be loaded. Refresh and try again."));
        setLoadState("error");
      });

    return () => {
      current = false;
    };
  }, [boardId, requestVersion, workspaceId]);

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (projectId === savedProjectId && sharingPolicy === savedSharingPolicy) return;
    setPendingAction("organization");
    setError("");
    setStatusMessage("");
    try {
      const board = await updateBoardMetadata({ boardId, projectId, sharingPolicy });
      setProjectId(board.projectId);
      setSavedProjectId(board.projectId);
      setSharingPolicy(board.sharingPolicy);
      setSavedSharingPolicy(board.sharingPolicy);
      await onBoardAccessChanged();
      setStatusMessage("Board organization updated");
    } catch (caught) {
      setError(safeError(caught, "Board organization could not be updated. Refresh and try again."));
    } finally {
      setPendingAction(null);
    }
  }

  async function transferOwnership() {
    if (!confirmTransfer || transferTargetId === ownerId) return;
    setPendingAction("transfer");
    setError("");
    setStatusMessage("");
    try {
      const board = await updateBoardMetadata({ boardId, ownerId: transferTargetId });
      const nextOwner = workspaceMembers.find((member) => member.userId === board.ownerId);
      setOwnerId(board.ownerId);
      setTransferTargetId(board.ownerId);
      setConfirmTransfer(false);
      setStatusMessage(`Transferred board ownership to ${nextOwner ? memberLabel(nextOwner) : "the selected member"}`);

      const currentWorkspaceRole = workspaceMembers.find(
        (member) => member.userId === currentUser.id,
      )?.role;
      if (currentWorkspaceRole !== "owner" && board.ownerId !== currentUser.id) {
        onManagementLost();
      }
      await onBoardAccessChanged();
    } catch (caught) {
      setError(safeError(caught, "Board ownership could not be transferred. Refresh and try again."));
    } finally {
      setPendingAction(null);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) return;
    setPendingAction("add-member");
    setError("");
    setStatusMessage("");
    try {
      const member = await addBoardMember({ boardId, email: normalizedEmail, role: newRole });
      setBoardMembers((current) => [...current, member]);
      setEmail("");
      setNewRole("viewer");
      setStatusMessage(`Added ${memberLabel(member)} directly to the board`);
    } catch (caught) {
      setError(safeError(caught, "The board member could not be added. Check the email and try again."));
    } finally {
      setPendingAction(null);
    }
  }

  async function changeMemberRole(member: BoardMember, role: BoardAccessRole) {
    if (member.role === role) return;
    setPendingMemberId(member.userId);
    setError("");
    setStatusMessage("");
    try {
      const updated = await updateBoardMember({ boardId, userId: member.userId, role });
      setBoardMembers((current) =>
        current.map((candidate) =>
          candidate.userId === member.userId ? { ...candidate, role: updated.role } : candidate,
        ),
      );
      setStatusMessage(`Changed ${memberLabel(member)} to ${accessRoleLabel(updated.role)}`);
    } catch (caught) {
      setError(safeError(caught, "The direct board role could not be changed. Refresh and try again."));
    } finally {
      setPendingMemberId(null);
    }
  }

  async function removeMember(member: BoardMember) {
    if (confirmRemoveId !== member.userId) return;
    setPendingMemberId(member.userId);
    setError("");
    setStatusMessage("");
    try {
      await removeBoardMember({ boardId, userId: member.userId });
      setBoardMembers((current) => current.filter((candidate) => candidate.userId !== member.userId));
      setConfirmRemoveId(null);
      setStatusMessage(`Removed ${memberLabel(member)} from direct board access`);
    } catch (caught) {
      setError(safeError(caught, "The board member could not be removed. Refresh and try again."));
    } finally {
      setPendingMemberId(null);
    }
  }

  if (loadState === "idle" || loadState === "loading") {
    return (
      <section className="flex flex-col gap-3" aria-label="Loading board access settings">
        <div className="h-20 animate-pulse rounded-radius-lg bg-light-surface-tint motion-reduce:animate-none" />
        <div className="h-20 animate-pulse rounded-radius-lg bg-light-surface-tint motion-reduce:animate-none" />
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section className="flex flex-col items-start gap-3">
        <p className="rounded-radius-md bg-(--danger-soft) p-3 text-pretty text-base text-(--danger) sm:text-sm" role="alert">
          {error}
        </p>
        <Button onClick={() => {
          setLoadState("loading");
          setError("");
          setRequestVersion((version) => version + 1);
        }}>
          Refresh Board Access
        </Button>
      </section>
    );
  }

  const transferTarget = workspaceMembers.find((member) => member.userId === transferTargetId);
  const organizationChanged = projectId !== savedProjectId || sharingPolicy !== savedSharingPolicy;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="board-organization-heading">
        <div>
          <h3 id="board-organization-heading" className="font-medium">Board Organization</h3>
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            Choose where the board lives and which broader membership can inherit access.
          </p>
        </div>
        <form className="flex flex-col gap-3" onSubmit={saveOrganization}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="board-sharing-policy" className="flex min-w-0 flex-col gap-1.5 text-base font-medium sm:text-sm">
              <span>Sharing Policy</span>
              <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                <select
                  id="board-sharing-policy"
                  name="board-sharing-policy"
                  value={sharingPolicy}
                  onChange={(event) => setSharingPolicy(event.target.value as BoardSharingPolicy)}
                  disabled={pendingAction !== null}
                  className={selectClass}
                >
                  {sharingPolicies.map((policy) => (
                    <option key={policy} value={policy}>{sharingPolicyLabel(policy)}</option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
              </span>
            </label>
            <label htmlFor="board-project" className="flex min-w-0 flex-col gap-1.5 text-base font-medium sm:text-sm">
              <span>Project</span>
              <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                <select
                  id="board-project"
                  name="board-project"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  disabled={pendingAction !== null}
                  className={selectClass}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
              </span>
            </label>
          </div>
          <Button type="submit" className="self-start" disabled={!organizationChanged || pendingAction !== null}>
            {pendingAction === "organization" ? "Saving..." : "Save Organization"}
          </Button>
        </form>

        <div className="flex flex-col gap-3 border-t border-near-black-primary-text/8 pt-4">
          <label htmlFor="board-owner" className="flex min-w-0 flex-col gap-1.5 text-base font-medium sm:text-sm">
            <span>Board Owner</span>
            <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
              <select
                id="board-owner"
                name="board-owner"
                value={transferTargetId}
                onChange={(event) => {
                  setTransferTargetId(event.target.value);
                  setConfirmTransfer(false);
                }}
                disabled={pendingAction !== null}
                className={selectClass}
              >
                {workspaceMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {memberLabel(member)}{member.userId === ownerId ? " (Current)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
            </span>
          </label>
          {confirmTransfer && transferTarget ? (
            <div className="flex flex-col gap-3 rounded-radius-lg bg-(--danger-soft) p-3 ring-1 ring-(--danger-border)" role="alert">
              <p className="text-pretty text-base text-(--danger) sm:text-sm">
                Transfer ownership to {memberLabel(transferTarget)}? They will control direct access and public links immediately.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setConfirmTransfer(false)} disabled={pendingAction !== null}>Keep Current Owner</Button>
                <Button tone="danger" onClick={() => void transferOwnership()} disabled={pendingAction !== null}>
                  {pendingAction === "transfer" ? "Transferring..." : "Transfer Ownership"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              className="self-start"
              onClick={() => setConfirmTransfer(true)}
              disabled={transferTargetId === ownerId || pendingAction !== null}
            >
              Review Ownership Transfer
            </Button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-near-black-primary-text/8 pt-5" aria-labelledby="direct-board-members-heading">
        <div>
          <h3 id="direct-board-members-heading" className="font-medium">Direct Board Access</h3>
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            Direct roles take precedence over project or workspace inheritance.
          </p>
        </div>
        <form onSubmit={addMember} className="grid gap-3 rounded-radius-lg bg-light-surface-tint p-3 ring-1 ring-border-subtle sm:grid-cols-[1fr_9rem]">
          <label htmlFor="board-member-email" className="flex min-w-0 flex-col gap-1.5 text-base font-medium sm:text-sm">
            <span>Workspace Member Email</span>
            <input
              id="board-member-email"
              name="board-member-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              required
              disabled={pendingAction !== null}
              className={inputClass}
            />
          </label>
          <label htmlFor="board-member-role" className="flex min-w-0 flex-col gap-1.5 text-base font-medium sm:text-sm">
            <span>Board Role</span>
            <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
              <select
                id="board-member-role"
                name="board-member-role"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as BoardAccessRole)}
                disabled={pendingAction !== null}
                className={selectClass}
              >
                {accessRoles.map((role) => (
                  <option key={role} value={role}>{accessRoleLabel(role)}</option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
            </span>
          </label>
          <Button
            type="submit"
            className="self-start sm:col-span-2"
            disabled={pendingAction !== null}
            leading={<UserPlusIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          >
            {pendingAction === "add-member" ? "Adding..." : "Add Board Member"}
          </Button>
        </form>

        {boardMembers.length === 0 ? (
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            No direct members yet. Access currently comes from ownership or the selected sharing policy.
          </p>
        ) : (
          <ul className="divide-y divide-near-black-primary-text/8" role="list">
            {boardMembers.map((member) => {
              const pending = pendingMemberId === member.userId;
              const confirming = confirmRemoveId === member.userId;
              return (
                <li key={member.userId} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar user={{ name: member.name, email: null, image: member.image }} size="small" />
                    <p className="min-w-0 truncate text-base font-medium sm:text-sm">{memberLabel(member)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <label>
                      <span className="sr-only">Direct board role for {memberLabel(member)}</span>
                      <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                        <select
                          name={`board-role-${member.userId}`}
                          value={member.role}
                          onChange={(event) => void changeMemberRole(member, event.target.value as BoardAccessRole)}
                          disabled={pending || pendingAction !== null}
                          className={selectClass}
                        >
                          {accessRoles.map((role) => (
                            <option key={role} value={role}>{accessRoleLabel(role)}</option>
                          ))}
                        </select>
                        <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
                      </span>
                    </label>
                    {confirming ? (
                      <>
                        <Button onClick={() => setConfirmRemoveId(null)} disabled={pending}>Keep Member</Button>
                        <Button tone="danger" onClick={() => void removeMember(member)} disabled={pending}>
                          {pending ? "Removing..." : "Confirm Remove"}
                        </Button>
                      </>
                    ) : (
                      <Button tone="ghost" onClick={() => setConfirmRemoveId(member.userId)} disabled={pending}>
                        Remove Member
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {(error || statusMessage) ? (
          <p
            className={cx(
              "rounded-radius-md p-3 text-pretty text-base ring-1 sm:text-sm",
              error
                ? "bg-(--danger-soft) text-(--danger) ring-(--danger-border)"
                : "bg-sky-blue-accent/10 text-sky-blue-accent ring-sky-blue-accent/20",
            )}
            role={error ? "alert" : "status"}
          >
            {error || statusMessage}
          </p>
        ) : null}
      </section>
    </div>
  );
}

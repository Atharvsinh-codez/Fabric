"use client";

import { ChevronDownIcon, UserPlusIcon } from "@heroicons/react/16/solid";
import { useEffect, useState, type FormEvent } from "react";

import { Button, UserAvatar, cx } from "@/components/ui";
import type { BoardAccessRole } from "@/db/schema/product";
import {
  addProjectMember,
  FabricApiError,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  updateProjectMember,
  type ProjectMember,
  type ProjectSummary,
} from "@/lib/boards/client";

const accessRoles = ["editor", "commenter", "viewer"] as const satisfies readonly BoardAccessRole[];

const inputClass =
  "h-10 w-full rounded-radius-md bg-surface-white px-3 text-base text-near-black-primary-text outline-none ring-1 ring-border-subtle placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm";

const selectClass =
  "col-span-full row-start-1 h-10 w-full appearance-none rounded-radius-md bg-surface-white pr-8 pl-3 text-base text-near-black-primary-text outline-none ring-1 ring-border-subtle focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent disabled:bg-light-surface-tint disabled:text-muted-gray sm:h-9 sm:text-sm";

function accessRoleLabel(role: BoardAccessRole): string {
  if (role === "editor") return "Can Edit";
  if (role === "commenter") return "Can Comment";
  return "Can View";
}

function memberLabel(member: ProjectMember): string {
  return member.name?.trim() || "Workspace Member";
}

function safeError(error: unknown, fallback: string): string {
  if (error instanceof FabricApiError && error.message) return error.message;
  return fallback;
}

export function ProjectMembersPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectState, setProjectState] = useState<"loading" | "ready" | "error">("loading");
  const [projectError, setProjectError] = useState("");
  const [projectRequestVersion, setProjectRequestVersion] = useState(0);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [memberState, setMemberState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [memberError, setMemberError] = useState("");
  const [memberRequestVersion, setMemberRequestVersion] = useState(0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BoardAccessRole>("viewer");
  const [adding, setAdding] = useState(false);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    let active = true;

    void listProjects(workspaceId)
      .then((result) => {
        if (!active) return;
        setProjects(result);
        const initialProject = result.find((project) => project.isDefault) ?? result[0];
        setMemberState(initialProject ? "loading" : "idle");
        setSelectedProjectId(initialProject?.id ?? "");
        setProjectState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProjects([]);
        setProjectError(safeError(error, "Projects could not be loaded. Refresh the list and try again."));
        setProjectState("error");
      });

    return () => {
      active = false;
    };
  }, [projectRequestVersion, workspaceId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    let active = true;

    void listProjectMembers({ workspaceId, projectId: selectedProjectId })
      .then((result) => {
        if (!active) return;
        setMembers(result);
        setMemberState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMembers([]);
        setMemberError(safeError(error, "Project members could not be loaded. Refresh the list and try again."));
        setMemberState("error");
      });

    return () => {
      active = false;
    };
  }, [memberRequestVersion, selectedProjectId, workspaceId]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!canManage || !selectedProjectId || !normalizedEmail) return;
    setAdding(true);
    setMemberError("");
    setStatusMessage("");
    try {
      const member = await addProjectMember({
        workspaceId,
        projectId: selectedProjectId,
        email: normalizedEmail,
        role,
      });
      setMembers((current) => [...current, member]);
      setEmail("");
      setRole("viewer");
      setStatusMessage(`Added ${memberLabel(member)} to the project`);
    } catch (error) {
      setMemberError(safeError(error, "The project member could not be added. Check the email and try again."));
    } finally {
      setAdding(false);
    }
  }

  async function changeRole(member: ProjectMember, nextRole: BoardAccessRole) {
    if (!canManage || !selectedProjectId || member.role === nextRole) return;
    setPendingMemberId(member.userId);
    setMemberError("");
    setStatusMessage("");
    try {
      const updated = await updateProjectMember({
        workspaceId,
        projectId: selectedProjectId,
        userId: member.userId,
        role: nextRole,
      });
      setMembers((current) =>
        current.map((candidate) =>
          candidate.userId === member.userId ? { ...candidate, role: updated.role } : candidate,
        ),
      );
      setStatusMessage(`Changed ${memberLabel(member)} to ${accessRoleLabel(updated.role)}`);
    } catch (error) {
      setMemberError(safeError(error, "The project role could not be changed. Refresh the list and try again."));
    } finally {
      setPendingMemberId(null);
    }
  }

  async function removeMember(member: ProjectMember) {
    if (!canManage || !selectedProjectId || confirmRemoveId !== member.userId) return;
    setPendingMemberId(member.userId);
    setMemberError("");
    setStatusMessage("");
    try {
      await removeProjectMember({
        workspaceId,
        projectId: selectedProjectId,
        userId: member.userId,
      });
      setMembers((current) => current.filter((candidate) => candidate.userId !== member.userId));
      setConfirmRemoveId(null);
      setStatusMessage(`Removed ${memberLabel(member)} from the project`);
    } catch (error) {
      setMemberError(safeError(error, "The project member could not be removed. Refresh the list and try again."));
    } finally {
      setPendingMemberId(null);
    }
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  return (
    <section aria-labelledby="project-member-heading" className="border-t border-border-subtle pt-8">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="project-member-heading" className="text-balance text-base font-semibold">
              Project Access
            </h2>
            <p className="max-w-[68ch] text-pretty text-base text-dark-text-alt sm:text-sm">
              Project roles apply only to boards whose sharing policy is set to Project.
            </p>
          </div>
          {projectState === "ready" && projects.length > 0 ? (
            <label htmlFor="project-member-project" className="flex min-w-0 flex-col gap-2 text-base font-medium sm:w-64 sm:text-sm">
              <span>Project</span>
              <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                <select
                  id="project-member-project"
                  name="project-member-project"
                  value={selectedProjectId}
                  onChange={(event) => {
                    setSelectedProjectId(event.target.value);
                    setMemberState("loading");
                    setMemberError("");
                    setConfirmRemoveId(null);
                    setStatusMessage("");
                  }}
                  className={selectClass}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
              </span>
            </label>
          ) : null}
        </div>

        {projectState === "loading" ? (
          <div className="h-20 animate-pulse rounded-radius-lg bg-light-surface-tint motion-reduce:animate-none" aria-label="Loading projects" />
        ) : null}

        {projectState === "error" ? (
          <div className="flex flex-col items-start gap-3 rounded-radius-lg bg-red-50 p-4 ring-1 ring-red-200">
            <p className="text-pretty text-base text-red-700 sm:text-sm" role="alert">{projectError}</p>
            <Button onClick={() => {
              setProjectState("loading");
              setProjectError("");
              setProjectRequestVersion((version) => version + 1);
            }}>
              Refresh Projects
            </Button>
          </div>
        ) : null}

        {projectState === "ready" && projects.length === 0 ? (
          <p className="rounded-radius-lg bg-light-surface-tint p-4 text-pretty text-base text-dark-text-alt ring-1 ring-border-subtle sm:text-sm">
            No projects yet. Create a project from the Boards page to manage project-level access.
          </p>
        ) : null}

        {selectedProject ? (
          <>
            {canManage ? (
              <form onSubmit={addMember} className="grid gap-3 rounded-radius-lg bg-light-surface-tint p-4 ring-1 ring-border-subtle sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                <label htmlFor="project-member-email" className="flex min-w-0 flex-col gap-2 text-base font-medium sm:text-sm">
                  <span>Workspace Member Email</span>
                  <input
                    id="project-member-email"
                    name="project-member-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="teammate@example.com"
                    required
                    disabled={adding}
                    className={inputClass}
                  />
                </label>
                <label htmlFor="project-member-role" className="flex min-w-0 flex-col gap-2 text-base font-medium sm:text-sm">
                  <span>Project Role</span>
                  <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                    <select
                      id="project-member-role"
                      name="project-member-role"
                      value={role}
                      onChange={(event) => setRole(event.target.value as BoardAccessRole)}
                      disabled={adding}
                      className={selectClass}
                    >
                      {accessRoles.map((candidate) => (
                        <option key={candidate} value={candidate}>{accessRoleLabel(candidate)}</option>
                      ))}
                    </select>
                    <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
                  </span>
                </label>
                <Button
                  type="submit"
                  disabled={adding}
                  leading={<UserPlusIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
                >
                  {adding ? "Adding..." : "Add to Project"}
                </Button>
              </form>
            ) : (
              <p className="rounded-radius-lg bg-light-surface-tint p-4 text-pretty text-base text-dark-text-alt ring-1 ring-border-subtle sm:text-sm">
                You can review explicit access to {selectedProject.name}. Only workspace owners can change project members.
              </p>
            )}

            {(memberError || statusMessage) ? (
              <p
                className={cx(
                  "rounded-radius-lg px-3 py-2 text-pretty text-base ring-1 sm:text-sm",
                  memberError
                    ? "bg-red-50 text-red-700 ring-red-200"
                    : "bg-sky-blue-accent/10 text-sky-blue-accent ring-sky-blue-accent/20",
                )}
                role={memberError ? "alert" : "status"}
              >
                {memberError || statusMessage}
              </p>
            ) : null}

            {memberState === "loading" ? (
              <div className="flex flex-col gap-3" aria-label="Loading project members">
                {[0, 1].map((item) => (
                  <div key={item} className="h-14 animate-pulse rounded-radius-md bg-light-surface-tint motion-reduce:animate-none" />
                ))}
              </div>
            ) : null}

            {memberState === "error" ? (
              <Button onClick={() => {
                setMemberState("loading");
                setMemberError("");
                setMemberRequestVersion((version) => version + 1);
              }}>
                Refresh Project Members
              </Button>
            ) : null}

            {memberState === "ready" && members.length === 0 ? (
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                No explicit project members yet. Workspace and board ownership can still grant access.
              </p>
            ) : null}

            {memberState === "ready" && members.length > 0 ? (
              <ul className="divide-y divide-border-subtle" role="list" aria-label={`${selectedProject.name} members`}>
                {members.map((member) => {
                  const pending = pendingMemberId === member.userId;
                  const confirming = confirmRemoveId === member.userId;
                  return (
                    <li key={member.userId} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <UserAvatar user={{ name: member.name, email: null, image: member.image }} size="medium" />
                        <div className="min-w-0">
                          <p className="truncate text-base font-medium sm:text-sm">{memberLabel(member)}</p>
                          <p className="tabular-nums text-base text-muted-gray sm:text-sm">
                            Added {new Date(member.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {canManage ? (
                          <label>
                            <span className="sr-only">Project role for {memberLabel(member)}</span>
                            <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                              <select
                                name={`project-role-${member.userId}`}
                                value={member.role}
                                onChange={(event) => void changeRole(member, event.target.value as BoardAccessRole)}
                                disabled={pending}
                                className={selectClass}
                              >
                                {accessRoles.map((candidate) => (
                                  <option key={candidate} value={candidate}>{accessRoleLabel(candidate)}</option>
                                ))}
                              </select>
                              <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
                            </span>
                          </label>
                        ) : (
                          <p className="rounded-radius-pill bg-light-surface-tint px-2 py-1 text-base font-medium text-dark-text-alt ring-1 ring-border-subtle sm:text-sm">
                            {accessRoleLabel(member.role)}
                          </p>
                        )}
                        {canManage ? (
                          confirming ? (
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
                          )
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

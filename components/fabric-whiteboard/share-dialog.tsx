"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  ClipboardDocumentIcon,
  LinkIcon,
  NoSymbolIcon,
} from "@heroicons/react/16/solid";
import { useState, type FormEvent } from "react";

import { BoardAccessAdministration } from "@/components/fabric-whiteboard/board-access-administration";
import { FabricDialog } from "@/components/fabric-whiteboard/fabric-dialog";
import { Button } from "@/components/ui";
import type {
  BoardSharingPolicy,
  ShareLinkPermission,
  WorkspaceRole,
} from "@/db/schema/product";
import { useBoardShareLinks } from "@/lib/boards/use-board-share-links";

type ExpiryChoice = "never" | "7-days" | "30-days";

function expirationFor(choice: ExpiryChoice): string | null {
  if (choice === "never") return null;
  const days = choice === "7-days" ? 7 : 30;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function formatDate(value: string | null): string {
  if (!value) return "No expiration";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function FabricShareDialog({
  boardId,
  workspaceId,
  ownerId,
  projectId,
  sharingPolicy,
  role,
  managementAuthorized,
  organizationEnabled,
  open,
  onClose,
  onBoardAccessChanged,
  onManagementLost,
}: {
  boardId: string;
  workspaceId: string;
  ownerId: string;
  projectId: string;
  sharingPolicy: BoardSharingPolicy;
  role: WorkspaceRole;
  managementAuthorized: boolean;
  organizationEnabled: boolean;
  open: boolean;
  onClose: () => void;
  onBoardAccessChanged: () => void | Promise<unknown>;
  onManagementLost: () => void;
}) {
  const [managementLost, setManagementLost] = useState(false);
  const canManage =
    managementAuthorized && role === "owner" && !managementLost;
  const state = useBoardShareLinks(boardId, canManage && open);
  const [permission, setPermission] = useState<ShareLinkPermission>("viewer");
  const [expiry, setExpiry] = useState<ExpiryChoice>("7-days");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    try {
      const created = await state.createLink(permission, expirationFor(expiry));
      setCreatedUrl(new URL(created.path, window.location.origin).toString());
      setCopied(false);
      setCopyError(null);
    } catch {
      // The hook exposes the safe server error inline.
    }
  }

  async function copyCreatedUrl() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopied(false);
      setCopyError("The browser blocked clipboard access. Select the URL and copy it manually.");
    }
  }

  return (
    <FabricDialog
      open={open}
      title="Share Board"
      description={
        organizationEnabled
          ? "Manage direct access, organization, ownership, and scoped public links."
          : "Manage scoped public links for this board."
      }
      onClose={() => {
        setCreatedUrl(null);
        setCopied(false);
        setCopyError(null);
        onClose();
      }}
    >
      {!canManage ? (
        <p className="text-pretty text-base text-muted-gray sm:text-sm">
          {managementLost
            ? "Ownership changed. Your current access no longer includes board administration."
            : "Only board owners and workspace owners can manage direct access, organization, or public share links."}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {open && organizationEnabled ? (
            <BoardAccessAdministration
              boardId={boardId}
              workspaceId={workspaceId}
              initialOwnerId={ownerId}
              initialProjectId={projectId}
              initialSharingPolicy={sharingPolicy}
              onBoardAccessChanged={onBoardAccessChanged}
              onManagementLost={() => {
                setManagementLost(true);
                setCreatedUrl(null);
                setCopied(false);
                setCopyError(null);
                onManagementLost();
              }}
            />
          ) : null}

          <section className="flex flex-col gap-4 border-t border-near-black-primary-text/8 pt-5" aria-labelledby="public-share-links-heading">
            <div>
              <h3 id="public-share-links-heading" className="font-medium">Public Share Links</h3>
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                Create a revocable viewer or commenter link for people outside direct membership.
              </p>
            </div>
          <form className="flex flex-col gap-4" onSubmit={createLink}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1.5 font-medium" htmlFor="fabric-share-permission">
                Permission
                <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                  <select
                    id="fabric-share-permission"
                    name="share-permission"
                    value={permission}
                    onChange={(event) => setPermission(event.target.value as ShareLinkPermission)}
                    className="col-span-full row-start-1 h-10 appearance-none rounded-radius-md bg-surface-white px-2.5 pr-8 text-base font-normal outline-none ring-1 ring-near-black-primary-text/10 focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm"
                  >
                    <option value="viewer">Can View</option>
                    <option value="commenter">Can Comment</option>
                  </select>
                  <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 place-self-center shrink-0 fill-muted-gray" aria-hidden="true" />
                </span>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5 font-medium" htmlFor="fabric-share-expiry">
                Expires
                <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                  <select
                    id="fabric-share-expiry"
                    name="share-expiry"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value as ExpiryChoice)}
                    className="col-span-full row-start-1 h-10 appearance-none rounded-radius-md bg-surface-white px-2.5 pr-8 text-base font-normal outline-none ring-1 ring-near-black-primary-text/10 focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm"
                  >
                    <option value="7-days">In 7 Days</option>
                    <option value="30-days">In 30 Days</option>
                    <option value="never">Never</option>
                  </select>
                  <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 place-self-center shrink-0 fill-muted-gray" aria-hidden="true" />
                </span>
              </label>
            </div>
            <Button
              type="submit"
              tone="primary"
              className="self-start"
              disabled={state.creating}
              leading={<LinkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
            >
              {state.creating ? "Creating…" : "Create Share Link"}
            </Button>
          </form>

          {createdUrl ? (
            <section className="flex flex-col gap-3 rounded-radius-lg bg-(--accent-soft) p-4" aria-live="polite">
              <div className="flex items-start gap-2">
                <CheckIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
                <div className="min-w-0">
                  <h3 className="font-medium">Link Ready</h3>
                  <p className="text-pretty text-base text-dark-text-alt/70 sm:text-sm">
                    Fabric only shows the secret URL now. Copy it before closing this dialog.
                  </p>
                </div>
              </div>
              <label htmlFor="fabric-created-share-url" className="font-medium">Secret URL</label>
              <input
                id="fabric-created-share-url"
                name="created-share-url"
                value={createdUrl}
                readOnly
                className="h-10 min-w-0 rounded-radius-md bg-surface-white px-2.5 text-base outline-none ring-1 ring-near-black-primary-text/10 focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                className="self-start"
                onClick={() => void copyCreatedUrl()}
                leading={copied
                  ? <CheckIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
                  : <ClipboardDocumentIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
              >
                {copied ? "Link Copied" : "Copy Share Link"}
              </Button>
              {copyError ? (
                <p className="text-pretty text-base text-(--danger) sm:text-sm" role="alert">
                  {copyError}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-near-black-primary-text/8 pt-5">
            <div>
              <h3 className="font-medium">Existing Links</h3>
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                Raw URLs are never stored, but active links can be revoked here.
              </p>
            </div>
            {state.error ? (
              <p className="rounded-radius-md bg-(--danger-soft) p-3 text-base text-(--danger) sm:text-sm" role="alert">
                {state.error}
              </p>
            ) : state.loading ? (
              <p className="text-base text-muted-gray sm:text-sm" role="status">Loading share links…</p>
            ) : state.links.length === 0 ? (
              <p className="text-base text-muted-gray sm:text-sm">No share links yet. Create one above.</p>
            ) : (
              <ul className="flex flex-col" role="list">
                {state.links.map((link) => {
                  const revoked = Boolean(link.revokedAt);
                  return (
                    <li key={link.id} className="flex items-start justify-between gap-3 border-t border-near-black-primary-text/8 py-3 first:border-t-0 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-medium">{link.permission === "commenter" ? "Can Comment" : "Can View"}</p>
                        <p className="text-base text-muted-gray sm:text-sm">
                          {revoked ? "Revoked" : formatDate(link.expiresAt)}
                        </p>
                      </div>
                      {!revoked ? (
                        <Button
                          tone="ghost"
                          disabled={state.revokingId === link.id}
                          onClick={() => {
                            void state.revokeLink(link.id).catch(() => undefined);
                          }}
                          leading={<NoSymbolIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
                        >
                          {state.revokingId === link.id ? "Revoking…" : "Revoke Link"}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          </section>
        </div>
      )}
    </FabricDialog>
  );
}

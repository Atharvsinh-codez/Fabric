# Fabric production runbook

This runbook describes the production boundary implemented in this repository. It uses placeholders only. Keep real credentials in managed secret stores and inject them separately into Vercel and Cloudflare.

## 1. Production topology

Production uses two public runtimes with distinct responsibilities:

1. Vercel runs the Next.js App Router for pages, Auth.js, APIs, board checkpoints, authenticated realtime-ticket minting, streamed AI responses, and on-demand AI job processing.
2. A Cloudflare Worker routes each scoped WebSocket to one SQLite-backed Durable Object for Yjs persistence, acknowledgements, broadcast, and ephemeral awareness; a separate workspace coordinator Durable Object routes authenticated access-revocation events to affected rooms.
3. Private Cloudflare R2 buckets store board image/video bytes and custom avatar bytes. Neon stores their tenant-scoped metadata, authorization, and cleanup outbox.

The application remains canonical for HTTP and authentication, while the browser connects directly to the dedicated Worker hostname for realtime:

```text
https://app.example.com/*                         -> Vercel / Next.js
POST https://app.example.com/api/realtime/ticket  -> authenticated ticket mint
GET  https://app.example.com/api/internal/realtime-revocations
                                                   -> protected bounded outbox dispatch
wss://fabric-realtime.example.workers.dev/realtime/<board>/<generation>
                                                   -> Worker + Durable Object
Neon pooled connection #1                         -> fabric_web
Neon pooled connection #2                         -> fabric_worker for AI dispatch
Neon direct connection                            -> fabric_migrator during releases only
private R2 buckets                                -> board media + custom avatars
```

Vercel verifies the signed-in principal and board membership before issuing a short-lived ticket. The Worker validates the exact app origin and uses the same signing key, issuer, and audience to verify that ticket as the first WebSocket frame. Tokens never appear in WebSocket URLs. Durable Objects own realtime update order, idempotency, snapshots, ticket redemption, and room fan-out; they do not receive Neon credentials.

`npm run dev` may still start the repository's custom single-process server for local development. Vercel never executes `server.ts`, so the production WebSocket URL must not point at Vercel's `/realtime` path. Deployment and rollback commands are maintained in `cloudflare/realtime/README.md`.

## 2. Environment and secret boundaries

Start from `.env.example`, but map each value only to the runtime that uses it. Never copy the complete local environment into both providers.

### Listener and canonical origin

- Vercel `FABRIC_ENV=production`
- `APP_URL`, `AUTH_URL`, and `NEXT_PUBLIC_APP_URL` set to the same canonical HTTPS origin
- Vercel `NEXT_PUBLIC_REALTIME_URL` set to the Worker origin with `wss` and exact base path `/realtime`, for example `wss://fabric-realtime.example.workers.dev/realtime`

Production auth validation uses the canonical Vercel HTTPS origin. Cloudflare is a second public hostname only for `/health` and scoped WebSocket upgrades; its exact origin allowlist contains the canonical application origin.

### Auth and health

- `AUTH_SECRET` with at least 32 unpredictable characters
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`
- `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`
- `HEALTHCHECK_SECRET` with at least 32 unpredictable characters

Set `AUTH_TRUST_HOST=true` only when a trusted ingress controls and sanitizes forwarded host headers.

### Workspace rollout control

The new project/status/favorite/archive/direct-membership UI and private R2 upload/custom-avatar upload paths are protected by a server-evaluated workspace rollout. Configure only Vercel with:

- `FABRIC_WORKSPACE_ROLLOUT_MODE=off|canary|all`
- `FABRIC_WORKSPACE_CANARY_IDS=<comma-separated canonical workspace UUIDs>` when mode is `canary`

Missing mode is safe: production defaults to `off`, while local, preview, staging, and tests default to `all`. Canary mode requires at least one canonical lowercase UUID, rejects malformed/duplicate/empty entries, and compares exact workspace IDs. These are server-only values; no request header, query parameter, cookie, or `NEXT_PUBLIC_*` value can override the decision.

The gate controls feature activation, not baseline access. Board viewing/editing, realtime tickets, comments, checkpoints, public-share reads, existing asset/avatar reads, legacy server-mediated image paste/upload/delete, and clearing an existing custom avatar remain available while rollout is off. New R2 initiation/finalization, R2 videos, custom-avatar uploads, covers, projects, board/project memberships, preferences, status, archive/restore, and advanced board views require an enabled workspace. A user-global custom avatar upload is allowed only when that user belongs to at least one enabled workspace.

### Separate Neon connections on Vercel

- pooled `DATABASE_URL` for `fabric_web`
- optional pooled `WORKER_DATABASE_URL` for the bounded serverless AI dispatcher using `fabric_worker`; when omitted, Vercel uses the already-authorized `DATABASE_URL` role for that in-request dispatch
- direct `DATABASE_URL_DIRECT` for the DDL-capable `fabric_migrator`; release commands only

Attached worker runtimes still fail rather than reuse the web credential. The Cloudflare realtime Worker uses Durable Object SQLite and receives no database URL. `REALTIME_DATABASE_URL` is retained only for the local/legacy custom Node realtime runtime.

### Realtime protocol

- the same `REALTIME_TICKET_SIGNING_KEY` in Vercel and as a protected Cloudflare Worker secret
- matching `REALTIME_ISSUER` in Vercel and Cloudflare
- matching `REALTIME_AUDIENCE` in Vercel and Cloudflare
- `REALTIME_ALLOWED_ORIGINS` on both runtimes containing only the exact canonical HTTPS app origin
- `FABRIC_BOARD_ROOMS` bound to the `FabricBoardRoom` Durable Object class
- `FABRIC_ACCESS_COORDINATORS` bound to the additive `WorkspaceAccessCoordinator` class
- Vercel `REALTIME_REVOCATION_ENDPOINT` set to the exact Worker HTTPS `/internal/revocations` endpoint
- the same `REALTIME_COORDINATOR_SECRET` on Vercel and Cloudflare, distinct from the ticket signing key
- Vercel-only `REALTIME_REVOCATION_DISPATCH_SECRET`, distinct from every other secret, protecting the hosted cron route

The WebSocket upgrade contains no bearer token in its URL; the browser obtains a short-lived, single-use ticket from the authenticated Vercel API and submits it as the first frame. Cloudflare stores redemption state in the room Durable Object, so the production Worker does not use `REALTIME_TICKET_REDEMPTION_KEY`. The coordinator endpoint is server-to-server only, validates a bounded body with a timing-safe bearer comparison, and never accepts browser credentials.

### Private R2 media

Vercel receives these server-only values:

- `FABRIC_R2_ACCOUNT_ID`
- `FABRIC_R2_ACCESS_KEY_ID`
- `FABRIC_R2_SECRET_ACCESS_KEY`
- `FABRIC_R2_BOARD_ASSET_BUCKET`
- `FABRIC_R2_AVATAR_BUCKET`
- `FABRIC_R2_PRESIGN_TTL_SECONDS=300`
- `MEDIA_CLEANUP_SECRET`, a distinct random bearer secret of at least 32 characters

Use an R2 S3 token limited to the private media buckets. One private bucket may be supplied for both bucket variables during an initial deployment, but separate buckets simplify access boundaries, quotas, and operational accounting. Never expose the S3 endpoint or credential through `NEXT_PUBLIC_*`.

Create each bucket as private, leave its `r2.dev` development URL disabled, and do not attach a public custom domain. Scope the S3 token to only the configured bucket or buckets with the object read/write operations needed for PUT, HEAD, GET, COPY, and DELETE; do not use an account-wide administrative key.

Configure this [R2 CORS policy](https://developers.cloudflare.com/r2/buckets/cors/) on each distinct configured bucket, replacing only the canonical application origin:

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://app.example.com"],
        "methods": ["PUT"],
        "headers": [
          "Content-Type",
          "If-None-Match",
          "x-amz-meta-fabric-content-sha256",
          "x-amz-meta-fabric-byte-size",
          "x-amz-meta-fabric-media-type",
          "x-amz-meta-fabric-upload-kind",
          "x-amz-meta-fabric-owner-id",
          "x-amz-meta-fabric-expires-at"
        ]
      },
      "maxAgeSeconds": 3600
    }
  ]
}
```

This is the current Wrangler/R2 API shape (`rules` with lowercase `allowed` fields), not the AWS S3 `AllowedOrigins`/`AllowedMethods` shape. Apply it with `wrangler r2 bucket cors set <bucket> --file <policy>`, then list the remote policy again before enabling uploads.

Do not use `*` for a production origin or allowed headers. Fabric does not need response headers exposed to browser JavaScript. Downloads remain same-origin authenticated Fabric API requests; only the short-lived, exact-key PUT uses the cross-origin presigned R2 URL. Treat that URL as a temporary bearer credential and keep it out of logs and persisted canvas state.

Uploads use short-lived, write-once staging keys. The server streams and verifies size, SHA-256, declared type, content signature, and signed metadata before copying to an immutable final key. Neon is updated only after promotion. Replaced, rejected, expired, and staging objects are removed through the durable `asset_object_deletions` outbox and the bounded protected cleanup route. If promotion succeeds but a database outcome stays ambiguous and the client never retries, reservation expiry also reconciles the deterministic, unreferenced final key into that outbox; referenced board assets and current avatars are excluded transactionally.

### AI serverless dispatch

- `AI_PROVIDER=openai-compatible`
- `AI_BASE_URL` set to an HTTPS OpenAI-compatible `/v1` endpoint with no credentials or query string
- `AI_API_KEYS` (optional preferred pool; 1-16 trimmed, deduplicated keys as a comma/newline-separated list or JSON string array)
- `AI_API_KEY` when exactly one server-only credential is configured
- `AI_MODEL` set to the reviewed provider model identifier
- `AI_STREAM_ONLY=true`
- `AI_RUNS_ENABLED=true` only when production should accept work
- `AI_SERVERLESS_DISPATCH_ENABLED=true` when running outside Vercel detection
- the lease, retention, and budget values from `.env.example`

Vercel claims only the authenticated run attached to the current SSE request and keeps the bounded dispatch promise tied to that response lifecycle. The provider adapter sends only streamed OpenAI-compatible Chat Completions requests; it never falls back to a buffered or non-streaming model call. The browser cannot replace the provider endpoint, model, response schema, or safety limits. Terminal event retention defaults to 14 days and terminal run retention to 30 days.

When both key variables are present, `AI_API_KEYS` is authoritative; a malformed preferred list fails readiness instead of silently falling back. Multiple keys are for controlled credential rotation and availability failover, not for bypassing a provider quota. Store either variable only in server/worker secret storage and never in a `NEXT_PUBLIC_*` setting.

### Browser-visible build inputs

These values are embedded by the Next.js build and require a rebuild when changed:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_REALTIME_URL`

Never put OAuth secrets, Neon URLs, AI provider keys, readiness credentials, or realtime keys in `NEXT_PUBLIC_*` variables, command arguments, logs, or release artifacts.

### Rotation

Rotate immediately if any credential appears in a terminal recording, issue, chat, commit, build log, artifact, or browser bundle. Rotate Google/GitHub secrets in their consoles, Neon role passwords independently, `AUTH_SECRET` with planned session invalidation, and shared production realtime signing/coordinator keys across Vercel and Cloudflare in one coordinated release. Rotate the Vercel-only dispatch key and any retained legacy redemption key independently.

## 3. Neon provisioning and migrations

Use one Neon project/database per environment. Create these identities:

- `fabric_migrator`: direct endpoint, DDL-capable, never used by the running application
- `fabric_web`: pooled endpoint
- `fabric_realtime`: pooled endpoint retained for legacy realtime data inspection, controlled cutover, or the local/custom Node runtime; never inject it into Cloudflare
- `fabric_worker`: pooled endpoint

Only `fabric_web` and `fabric_worker` are active runtime connections in the Vercel + Cloudflare production topology. Keeping the purpose-limited `fabric_realtime` role and legacy collaboration tables during the observation window makes rollback evidence and existing-room reconciliation possible without granting Cloudflare database access.

The committed migration sequence is ordered and forward-only. Release migrations `0006` through `0008` add runtime structures; `0009` is the reviewed status-constraint/data compatibility correction described below; `0010` adds bounded avatar upload reservations; `0011` and `0012` preserve the earlier Gemini rollout and credential-rotation provenance; and `0013` moves all new work to an env-selected OpenAI-compatible provider while keeping historical run rows readable. None deletes tenant or board rows:

| Migration | Boundary |
| --- | --- |
| `0000_auth_foundation.sql` | Auth.js users, accounts, sessions, metadata, and security records |
| `0001_product_persistence.sql` | Workspaces, memberships, boards, comments, and share links |
| `0002_realtime_collaboration.sql` | Yjs heads/updates, ticket redemption/rate windows, and security events |
| `0003_ai_durable_worker.sql` | AI runs, jobs, and event stream |
| `0004_sharp_nicolaos.sql` | Durable board checkpoints |
| `0005_board_assets.sql` | Board-scoped image blobs and metadata |
| `0006_cloudy_thunderball.sql` | Projects, effective board access, preferences/status/archive support, private R2 metadata, custom avatars, upload reservations, and cleanup outbox |
| `0007_condemned_iron_man.sql` | Append-only workspace audit events for guarded ownership and project/board membership administration |
| `0008_narrow_shadow_king.sql` | Transactional, leased, retryable realtime access-revocation outbox |
| `0009_young_chimera.sql` | Preserves `archived_at` as the archive source of truth, converts legacy stored `archived` workflow values to `active`, and restricts stored workflow status to draft/active/review/approved |
| `0010_heavy_boom_boom.sql` | Adds per-user, expiring avatar upload reservations so quota checks and finalization remain idempotent and concurrency-safe |
| `0011_blushing_korvac.sql` | Allows explicitly versioned `gemini-2.5-flash` runs while retaining `gemini-3.5-flash` for historical and mixed-version rollout provenance |
| `0012_chunky_vance_astro.sql` | Adds a standalone monotonic sequence used to choose the next Gemini credential across serverless and attached worker instances without rewriting AI job rows |
| `0013_foamy_lionheart.sql` | Removes legacy AI defaults and allows explicit `openai-compatible` runs with a bounded env-selected model identifier while retaining historical Gemini provenance |

### Pre-migration procedure

1. Confirm the Neon restore window or create a protected branch/snapshot according to the [Neon backup documentation](https://neon.com/docs/manage/backups).
2. Ensure only one release migrator is active.
3. Set `DATABASE_URL_DIRECT` to the direct migrator URL.
4. Validate and apply the committed migration sequence:

   ```powershell
   npm ci
   npm run db:check
   npm run db:migrate
   ```

5. Reapply and verify grants after any migration that adds a table or sequence.
6. Deploy the Cloudflare Worker and Vercel application only after schema and grants are ready.

Do not run `db:generate` during deployment. Generate and review migrations in development, commit them, and deploy only the committed sequence.

### Least-privilege grants

Run grants as the object owner after migrations. This block intentionally avoids broad default privileges and must be updated when a migration adds runtime objects.

```sql
GRANT USAGE ON SCHEMA public TO fabric_web, fabric_realtime, fabric_worker;

REVOKE ALL ON ALL TABLES IN SCHEMA public
  FROM fabric_web, fabric_realtime, fabric_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public
  FROM fabric_web, fabric_realtime, fabric_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  users,
  accounts,
  sessions,
  verification_tokens,
  session_metadata,
  account_link_intents,
  account_security_events,
  workspaces,
  workspace_memberships,
  projects,
  project_memberships,
  project_user_preferences,
  boards,
  board_memberships,
  board_user_preferences,
  board_comment_threads,
  board_comments,
  board_share_links,
  board_checkpoints,
  board_assets,
  ai_runs,
  ai_jobs,
  ai_run_events,
  realtime_ticket_mint_windows
TO fabric_web;

-- Leased media and revocation outboxes are retained for reconciliation. The
-- web runtime claims and completes rows but never hard-deletes their history.
GRANT SELECT, INSERT, UPDATE ON TABLE
  board_asset_uploads,
  avatar_upload_reservations,
  asset_object_deletions,
  realtime_revocation_outbox
TO fabric_web;

-- Product administration history is append-only for the web runtime.
GRANT SELECT, INSERT ON TABLE workspace_audit_events TO fabric_web;

-- Only the optional attached/legacy PostgreSQL realtime transport uses these
-- product grants. Production Cloudflare Durable Objects receive no Neon
-- credential. This role cannot mutate board or membership policy.
GRANT SELECT ON TABLE
  boards,
  workspace_memberships,
  board_memberships,
  project_memberships
TO fabric_realtime;
-- PostgreSQL requires UPDATE on at least one column of every table selected
-- FOR SHARE. Grant only the non-policy timestamp used for that lock privilege;
-- do not grant UPDATE on IDs, roles, ownership, sharing, or generation fields.
GRANT UPDATE (updated_at) ON TABLE
  boards,
  workspace_memberships,
  board_memberships,
  project_memberships
TO fabric_realtime;
GRANT SELECT, INSERT, UPDATE ON TABLE realtime_document_heads TO fabric_realtime;
GRANT SELECT, INSERT ON TABLE realtime_updates TO fabric_realtime;
GRANT INSERT, DELETE ON TABLE realtime_ticket_redemptions TO fabric_realtime;
GRANT INSERT ON TABLE realtime_security_events TO fabric_realtime;
GRANT DELETE ON TABLE realtime_ticket_mint_windows TO fabric_realtime;
GRANT USAGE, SELECT ON SEQUENCE realtime_security_events_id_seq
  TO fabric_realtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  ai_runs,
  ai_jobs,
  ai_run_events
TO fabric_worker;
GRANT SELECT ON TABLE boards TO fabric_worker;
GRANT USAGE, SELECT ON SEQUENCE ai_provider_key_ordinal_seq
  TO fabric_web, fabric_worker;
```

Inspect effective grants before rollout. In a Cloudflare-only production environment, verify that no deployed runtime possesses the `fabric_realtime` credential:

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee IN ('fabric_web', 'fabric_realtime', 'fabric_worker')
ORDER BY grantee, table_name, privilege_type;
```

Connect once with each pooled URL and run the corresponding readiness query. Do not give runtime roles object ownership, schema creation, role management, or access to another runtime's credential.

## 4. OAuth provider configuration

Create separate Google and GitHub OAuth applications for local, preview, staging, and production. For `https://app.example.com`, register these exact callbacks:

```text
Google: https://app.example.com/api/auth/callback/google
GitHub: https://app.example.com/api/auth/callback/github
```

Set each provider homepage to the same canonical origin. Do not register alternate host, scheme, path, or trailing variants. Auth.js uses 30-day database sessions. Provider identity metadata is stored, while OAuth access, refresh, and ID tokens are stripped before account persistence.

Before release, exercise new-user, returning-user, consent-denied, GitHub private-email, account-collision, suspended-account, sign-out, session-list, and session-revocation paths against dedicated staging OAuth applications.

## 5. Board assets and avatars

The board-scoped boundary accepts PNG, JPEG, GIF, and WebP images up to 5 MiB plus MP4 and WebM videos up to 50 MiB. Custom avatars accept the supported image formats up to 5 MiB. Content signatures, declared MIME types, byte length, SHA-256, and signed upload metadata are checked. The technical board ceiling is 1 GiB and 1,000 media records; workspace quotas should be selected from measured usage before broad rollout.

Member reads require effective board access. Public-share media reads require a live board share token, and neither object keys nor presigned URLs are persisted in the tldraw document. Stable same-origin Fabric URLs proxy private R2 objects and preserve video byte-range responses.

Schedule `GET /api/internal/media-cleanup` with `Authorization: Bearer <MEDIA_CLEANUP_SECRET>`. Alert on failures and growing pending/leased rows in `asset_object_deletions`. The current keys place staging and final data under `boards/<board-id>/...` and `avatars/<user-id>/...`; [R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) match leading prefixes, so a deletion rule on `boards/` or `avatars/` would also delete committed media. Do not install either broad rule. The application outbox is the authoritative cleanup workflow. A future defense-in-depth expiry rule first requires staging keys under a globally isolated leading prefix or a dedicated staging bucket.

Schedule `GET /api/internal/realtime-revocations` with `Authorization: Bearer <REALTIME_REVOCATION_DISPATCH_SECRET>` at least once per minute. Alert on failures, oldest-undelivered age, attempts approaching 100, or expired leases in `realtime_revocation_outbox`. Delivery is asynchronous by design: permission mutations commit immediately, room pages retry idempotently, and no accepted local edit waits for coordinator availability.

Use a scheduler that can attach the exact bearer value required by each route. This repository intentionally has no unauthenticated `vercel.json` cron entry, and the media and revocation routes use different purpose-separated secrets. Verify one authorized and one unauthorized call to each route in staging without printing either secret.

## 6. Build, deploy, and rollout

Use Node.js 22 and one repository checkout/commit. Set final `NEXT_PUBLIC_*` inputs in Vercel before its production build. Run the complete release gate locally or in CI:

```powershell
npm ci
npm run verify
```

Vercel builds and runs the Next.js application. It does not start `dist/server.mjs` and does not support this repository's custom WebSocket upgrade handler. Cloudflare builds the strict TypeScript `cloudflare/realtime/worker.ts` separately through `wrangler.toml`. Use `npm run dev` only on a developer machine; its custom single-process runtime at `http://localhost:3000` is not the production topology.

Exact Cloudflare setup, Vercel environment mapping, first-cutover precautions, deployment commands, and non-destructive rollback commands are in `cloudflare/realtime/README.md`.

### Rollout order

1. Create or verify a database restore point.
2. Apply migrations with `fabric_migrator`.
3. Apply and verify the web and worker grants; preserve but do not deploy the legacy realtime credential.
4. Verify the production Worker origin allowlist contains only the canonical Vercel HTTPS origin.
5. Dry-run, provision the signing and purpose-separated coordinator secrets, and deploy the Cloudflare Worker plus additive coordinator binding; verify its `/health` response before changing Vercel.
6. For an existing realtime deployment, close active editors and complete the saved-board cutover gate in `cloudflare/realtime/README.md`. Do not assume legacy Neon updates were imported into Durable Objects.
7. Set Vercel's final canonical app values, Worker WebSocket URL, and matching ticket claims, then deploy with `AI_RUNS_ENABLED=false`.
8. Check Vercel and Worker liveness, then complete OAuth and two-browser realtime smoke tests.
9. Set `AI_RUNS_ENABLED=true`, redeploy Vercel, and verify a streamed proposal completes, can be reviewed/applied, and can be cancelled.
10. Test projects, permission precedence, archive/restore, comments, checkpoints, private images/videos, custom avatars, sharing, and reconnect/offline recovery.
11. Schedule the protected media-cleanup and realtime-revocation routes; confirm one expired staging object is removed and one targeted membership downgrade reaches only the affected socket.

### Staging, canary, and gradual activation

Staging must have its own Neon database, private R2 buckets, OAuth applications, Worker/Durable Object namespaces, secrets, and canonical origin. Apply migrations through `0012`, reapply the grants, and complete the full permission, archive/restore, media, revocation, recovery, and 100-user zero-legitimate-throttle suites there before production data is touched.

Deploy backward-compatible database/API/Worker support with `FABRIC_WORKSPACE_ROLLOUT_MODE=off`. After staging passes, set `canary` plus one exact production workspace UUID, redeploy, and verify readiness reports `canary-ready` without exposing the allowlist. Compare the canary with the pre-release baseline for collaboration latency, reconnects, checkpoint age, revocation latency, R2 promotion/cleanup errors, cross-tenant denials, and shadow update telemetry. Add workspace UUIDs deliberately while the gates remain healthy, then use `all` only after the gradual observation window. Roll back feature activation by returning to `off`; baseline board editing and legacy image handling remain available, existing private media stays readable, and users can still clear an existing custom avatar.

Keep the previous Vercel deployment and Cloudflare Worker version IDs through the observation window. Roll Worker code back in place so Durable Object storage survives; never delete either binding/class, a migration tag, coordinator state, or room storage during an incident. Do not send a room back to the legacy Neon transport after it has accepted Durable Object writes without a tested reverse migration. The committed migration sequence through `0012` is forward-only; `0009` is a reviewed compatibility correction that preserves archive state in `archived_at`, `0010` is additive reservation state, `0011` only broadens the AI provenance constraint, and `0012` adds only the rotation sequence. Never invent a destructive down migration during an incident. Restore data into a separate Neon branch first, validate it, then cut traffic deliberately.

## 7. Health checks

Vercel liveness is public, dependency-free, and safe for a basic function probe:

```powershell
curl.exe -f https://app.example.com/api/health/live
```

The Cloudflare Worker exposes a dependency-light transport probe:

```powershell
curl.exe -f https://fabric-realtime.example.workers.dev/health
```

The Worker response must report `status: "ok"` and transport `cloudflare-durable-objects`. Vercel readiness is private and requires the bearer secret:

```powershell
curl.exe -f `
  -H "Authorization: Bearer $env:HEALTHCHECK_SECRET" `
  https://app.example.com/api/health/ready
```

On Vercel, readiness checks the web database, derives and probes the public HTTPS `/health` endpoint from `NEXT_PUBLIC_REALTIME_URL`, validates the bounded Cloudflare health contract, verifies the same-Worker purpose-separated revocation configuration, validates the private R2/cleanup configuration shape, validates the server-only workspace rollout configuration, and validates that the serverless AI configuration can accept runs. A successful response reports topology `vercel-serverless`, web `ready`, realtime `external-ready`, revocations `coordinator-ready`, media `private-r2-ready`, workspace rollout as `off-ready`, `canary-ready`, or `all-ready` without IDs, AI `serverless-ready`, and `acceptingAiRuns: true`. A missing or short configured secret returns `503`; a wrong token returns `401`; a database, Worker, URL-policy, revocation, media-configuration, rollout-configuration, or AI-configuration failure returns `503`.

The protected readiness check proves database and Worker reachability plus R2/revocation/AI configuration shape; it does not upload/read an R2 object, drain either scheduled outbox, or prove an authenticated collaboration workflow. Also monitor a staging-safe R2 upload/read/delete canary, both scheduler routes, an end-to-end synthetic ticket mint, a scoped WebSocket connection, and, when AI is enabled, a streamed AI run from outside both providers.

## 8. Verification and smoke tests

Run the same release gates as CI:

```powershell
npm ci
npm run verify
npm run db:check
npm audit --omit=dev
git diff --check
```

After deployment, test with non-admin accounts in at least two browser profiles:

- Google and GitHub sign-in, sign-out, session listing, and revocation
- onboarding, workspace creation, membership roles, and board creation
- board load, create/move/resize/edit, refresh persistence, reconnect, and offline recovery
- live edits, presence, and cursors from two clients on the same public origin
- comments, resolution/reopen, scoped share permission/expiry, and shared assets
- checkpoint creation and restore
- supported image/video and avatar uploads, byte-range playback, replacement cleanup, plus oversized and unsupported rejection
- private/project/workspace/direct board permission precedence and cross-workspace negative access
- favorite/pin/recent/shared/status/archive views and archive/restore preservation
- streamed AI progress, proposal review, durable apply, cancellation, provider failure, and reconnect
- viewer/commenter inability to perform owner/editor mutations

## 9. Backups, retention, and capacity

Neon restore protection is the recovery boundary for authentication, product data, saved board documents, checkpoints, media metadata, and AI records. Private R2 storage plus the deletion outbox hold the corresponding media bytes; any provider-side versioning or retention policy is an additional operator-controlled layer and must be tested separately. Cloudflare Durable Object storage is the authoritative live realtime log between board checkpoints. A complete recovery plan therefore covers all providers; a Neon restore alone is not a realtime-room restore.

Configure Neon protection for the selected plan and verify the actual restore window. For a portable Neon backup, run `pg_dump` from a protected release job or operator workstation using the direct endpoint:

```powershell
pg_dump --format=custom --no-owner --no-acl `
  --file fabric-$(Get-Date -Format yyyyMMdd-HHmmss).dump `
  $env:DATABASE_URL_DIRECT
```

Store dumps encrypted outside the application host. Regularly restore into an isolated database and run schema plus product smoke tests. Durable Object code rollback preserves room storage, while the continuously saved Neon board document provides the cross-provider recovery checkpoint. This repository does not currently export Durable Object room storage, so define and test the acceptable checkpoint recovery-point objective before broad production use. A backup or checkpoint that has not been restored is not a verified recovery point.

Capacity notes:

- The Cloudflare transport enforces the committed limits in `lib/realtime/constants.ts`, chunks large updates and snapshots below Durable Object SQLite row limits, and rejects oversized envelopes before persistence.
- Periodic room snapshots bound replay work. Once a snapshot is durable, compacted update payloads are pruned while bounded idempotency receipts remain long enough for safe retries; monitor per-room storage, compaction failures, and reconnect time.
- Awareness is ephemeral, lives only on room WebSockets/attachments, and is not a recovery source or Neon write path.
- R2 object count, bytes, range-read latency, failed promotions, and cleanup-outbox age must be monitored alongside Neon media metadata.
- The custom long-running AI loop performs terminal event/run retention cleanup, but Vercel's on-demand dispatcher does not run that maintenance loop. Add and monitor a protected scheduled cleanup before relying on the configured retention periods.
- OAuth sessions can live for up to 30 days; exercise account and session revocation during incident drills.

## 10. Monitoring and incidents

Collect correlated Vercel and Cloudflare logs, HTTP/WebSocket outcomes, Durable Object storage/room errors, Neon connection/storage metrics, AI queue age and attempts, OpenAI-compatible provider errors, and client sync failures. Keep user content, signed tickets, and secrets out of logs.

Alert on:

- Vercel liveness failures, Worker health failures, function errors, or Worker deployment rollbacks
- `room_unavailable`, quarantine, slow-consumer, or repeated reconnect events
- rising AI queued/leased age, dead jobs, rate limits, or provider authentication failures
- Neon connection saturation, migration drift, Durable Object storage growth, or backup failures
- ticket replay, idempotency conflict, permission denial, or invalid update spikes

During an incident:

1. Set Vercel `AI_RUNS_ENABLED=false` and redeploy before prolonged AI-provider maintenance so no new work is admitted.
2. Roll Worker code back in place by version; do not delete Durable Objects or switch a written room to the legacy Neon transport.
3. Preserve Vercel logs, Cloudflare logs/version IDs, Durable Object state, and database evidence before destructive remediation.
4. Rotate exposed credentials and invalidate affected sessions/tickets. Coordinate the shared realtime signing key across Cloudflare and Vercel.
5. Prefer the previous known-good provider deployment. Restore Neon state only through a tested branch/restore procedure.
6. Record the failure, recovery point, evidence, and follow-up owner.

## 11. Production release blockers

Do not call a deployment production-ready until all of the following are true:

- production Google and GitHub callbacks are registered and tested
- Vercel HTTPS and the dedicated Cloudflare `wss` endpoint are configured with exact origin validation
- Vercel and Cloudflare use the same realtime signing key, issuer, and audience, while the browser sees only the Worker base URL
- the purpose-separated coordinator secret is present on Vercel and Cloudflare, the dispatch secret is Vercel-only, and the protected revocation schedule/backlog alert are active
- `fabric_web` and `fabric_worker` are distinct pooled roles and their grants are verified; no Neon credential is exposed to Cloudflare
- the direct migrator is isolated from the running application
- migrations through `0013` are applied in order and the provider-rotation sequence grant is verified
- Neon protection plus a cross-provider board-checkpoint recovery drill are complete
- existing rooms pass the saved-board cutover gate or have a tested import; no legacy realtime tail is silently abandoned
- provider billing/quota is adequate and a streamed OpenAI-compatible run succeeds in the target environment
- AI event/run retention has a scheduled cleanup path for the serverless deployment
- Vercel liveness, Worker health, end-to-end synthetic readiness, dashboards, alerts, logs, and a rollback owner are configured
- credentials ever shared through insecure channels have been rotated
- both R2 buckets are private, exact-origin PUT CORS is verified, and no R2 credential or presigned URL appears in client bundles or persisted canvas state
- the protected media-cleanup schedule is active and its backlog/age is monitored
- the protected realtime-revocation schedule is active and undelivered/expired-lease age is monitored
- staging passed, production starts in rollout mode `off`, one exact canary workspace is verified in mode `canary`, and gradual activation has an owner

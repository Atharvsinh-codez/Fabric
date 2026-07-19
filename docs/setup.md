# Fabric setup guide

This guide takes a clean clone to a working Fabric installation. It covers the all-in-one local runtime, production-like Cloudflare Durable Object development, Neon, OAuth, private R2 media, the optional canvas agent, and the recommended production topology.

> [!IMPORTANT]
> Never copy values from another installation. Generate your own OAuth credentials, database passwords, R2 keys, and signing secrets. Keep `.env`, `.env.local`, `.env.worker.local`, and `.dev.vars*` untracked.

## Contents

1. [Choose a setup path](#1-choose-a-setup-path)
2. [Prerequisites](#2-prerequisites)
3. [Clone and install](#3-clone-and-install)
4. [Configure your fork](#4-configure-your-fork)
5. [Create the Neon database](#5-create-the-neon-database)
6. [Configure Google and GitHub OAuth](#6-configure-google-and-github-oauth)
7. [Configure the environment](#7-configure-the-environment)
8. [Run Fabric locally](#8-run-fabric-locally)
9. [Run Cloudflare realtime locally](#9-run-cloudflare-realtime-locally)
10. [Configure private Cloudflare R2](#10-configure-private-cloudflare-r2)
11. [Configure the Fabric agent](#11-configure-the-fabric-agent)
12. [Deploy Cloudflare realtime](#12-deploy-cloudflare-realtime)
13. [Deploy the web application](#13-deploy-the-web-application)
14. [Configure scheduled maintenance](#14-configure-scheduled-maintenance)
15. [Verify the installation](#15-verify-the-installation)
16. [Troubleshooting](#16-troubleshooting)
17. [Updating and rollback](#17-updating-and-rollback)

## 1. Choose a setup path

| Path | Best for | Realtime transport |
| --- | --- | --- |
| **All-in-one local** | Most contributors and product development | PostgreSQL-backed Node WebSocket server on port 3000 |
| **Local Cloudflare** | Realtime Worker and Durable Object development | Local Wrangler Worker on port 8787 |
| **Recommended production** | Public or team deployments | Deployed Cloudflare Worker and SQLite Durable Objects |
| **Custom Node host** | Advanced self-hosting on one long-running server | Attached PostgreSQL-backed WebSocket server |

Start with the all-in-one local path. It runs Next.js, the local realtime server, and the AI worker from `server.ts` under one origin. Cloudflare is not required for the first local boot.

The documented production topology is intentionally split:

```text
Browser ── HTTPS ──> Next.js web deployment ──> Neon / private R2 / AI provider
   └────── WSS ────> Cloudflare Worker ───────> Durable Object board room
```

There is currently no Docker Compose or one-command cloud infrastructure bootstrap. The commands in this guide use the repository's committed npm and Wrangler toolchain.

## 2. Prerequisites

Required for local development:

- [Git](https://git-scm.com/)
- Node.js **22** and npm
- A PostgreSQL database; [Neon](https://neon.com/) is the supported reference
- A Google OAuth application
- A GitHub OAuth application

Required only for the full feature set or production topology:

- A [Cloudflare](https://dash.cloudflare.com/) account for Workers, Durable Objects, and R2
- An HTTPS OpenAI-compatible Chat Completions provider for Fabric agent
- A web host that supports Next.js 16; Vercel is the reference deployment

Confirm the local tools:

```bash
node --version
npm --version
git --version
```

The Node version must begin with `v22`.

## 3. Clone and install

### macOS, Linux, or Git Bash

```bash
git clone https://github.com/Atharvsinh-codez/Fabric.git
cd Fabric
npm ci
cp .env.example .env
```

### Windows PowerShell

```powershell
git clone https://github.com/Atharvsinh-codez/Fabric.git
Set-Location Fabric
npm ci
Copy-Item .env.example .env
```

`npm ci` is intentional. It uses the committed lockfile and runs `patch-package`. Fabric keeps `tldraw` pinned exactly to `4.2.0` with a reviewed patch. Do not replace `npm ci` with an unreviewed dependency upgrade.

Optional personal overrides can go in `.env.local` and AI-worker overrides can go in `.env.worker.local`. These files do not need to exist and are ignored by Git.

## 4. Configure your fork

The upstream checkout contains Fabric's public site and Cloudflare deployment identity. A fork must replace these values before production deployment.

1. Update `SITE_URL` and `GITHUB_REPOSITORY_URL` in [`lib/site.ts`](../lib/site.ts).
2. Update the matching expectations in [`lib/site-metadata.test.ts`](../lib/site-metadata.test.ts).
3. In [`wrangler.toml`](../wrangler.toml), replace:
   - `name`
   - `account_id`
   - the production `REALTIME_ALLOWED_ORIGINS`
4. Replace the production origin in [`cloudflare/r2-cors.production.json`](../cloudflare/r2-cors.production.json).
5. Use separate Worker names, Durable Object namespaces, secrets, and origins for production, staging, and preview environments.

The production application treats `SITE_URL` as canonical for Auth.js and same-origin mutation checks. Changing only a deployment environment variable is not enough for a fork until `lib/site.ts` is updated.

Run these checks after changing the fork identity:

```bash
npm run typecheck
npm test -- lib/site-metadata.test.ts
npm run realtime:worker:types
```

## 5. Create the Neon database

Fabric uses one database per environment with separate credentials for each trust boundary.

| Role | Connection | Used by |
| --- | --- | --- |
| `fabric_migrator` | Direct, non-pooled | Drizzle migrations only |
| `fabric_web` | Pooled | Next.js/Auth.js/product APIs |
| `fabric_realtime` | Pooled | Attached local/custom Node realtime only |
| `fabric_worker` | Pooled | Attached AI worker |

### 5.1 Create a Neon project

1. Create a Neon project and database.
2. Create the four roles above in the Neon console.
3. Use Neon **Connect** to copy a connection string for each role.
4. Enable pooling for runtime roles. Their hostnames contain `-pooler`.
5. Disable pooling for the migrator URL. Its hostname must not contain `-pooler`.

Neon explains the difference in its [connection pooling guide](https://neon.com/docs/connect/connection-pooling). Schema migrations use the direct connection; application runtimes use pooled connections.

For a local-only installation, the Neon project owner may perform migrations, but runtime URLs should still use separate roles. Do not use the migration/owner credential in a deployed application.

### 5.2 Fill the database variables

```dotenv
DATABASE_URL=postgresql://fabric_web:...@...-pooler.neon.tech/fabric?sslmode=require
DATABASE_URL_DIRECT=postgresql://fabric_migrator:...@....neon.tech/fabric?sslmode=require
REALTIME_DATABASE_URL=postgresql://fabric_realtime:...@...-pooler.neon.tech/fabric?sslmode=require
WORKER_DATABASE_URL=postgresql://fabric_worker:...@...-pooler.neon.tech/fabric?sslmode=require
```

### 5.3 Apply the committed schema

```bash
npm run db:check
npm run db:migrate
```

Then apply the least-privilege grant block in the [production runbook](production-runbook.md#least-privilege-grants) as the database owner. Reapply and review grants whenever a future migration introduces a table or sequence.

Do not run `npm run db:generate` during deployment. Production releases apply only the ordered, reviewed migrations committed under `db/migrations/`.

## 6. Configure Google and GitHub OAuth

Fabric currently installs both providers, so both client ID/secret pairs are required.

### 6.1 Local callback URLs

Register these exact callbacks:

```text
Google: http://localhost:3000/api/auth/callback/google
GitHub: http://localhost:3000/api/auth/callback/github
```

For Google, also add this authorized JavaScript origin:

```text
http://localhost:3000
```

### 6.2 Production callback URLs

Replace `your-domain.example` with the canonical domain from `lib/site.ts`:

```text
Google: https://your-domain.example/api/auth/callback/google
GitHub: https://your-domain.example/api/auth/callback/github
```

Set the provider homepage/application URL to the same origin. Do not mix a Vercel preview domain, custom domain, trailing path, alternate scheme, or different callback host.

### 6.3 Add the credentials

```dotenv
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret
AUTH_GITHUB_ID=your-github-client-id
AUTH_GITHUB_SECRET=your-github-client-secret
```

## 7. Configure the environment

### 7.1 Generate purpose-separated secrets

Run this command once for each secret. Never reuse its output for two purposes.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Generate unique values for:

- `AUTH_SECRET`
- `REALTIME_TICKET_SIGNING_KEY`
- `REALTIME_TICKET_REDEMPTION_KEY`
- `REALTIME_COORDINATOR_SECRET`
- `REALTIME_REVOCATION_DISPATCH_SECRET`
- `MEDIA_CLEANUP_SECRET`
- `HEALTHCHECK_SECRET`

### 7.2 Canonical local URLs

```dotenv
FABRIC_ENV=local
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000
AUTH_URL=http://localhost:3000
REALTIME_ALLOWED_ORIGINS=http://localhost:3000
NEXT_PUBLIC_REALTIME_URL=ws://localhost:3000/realtime
```

`APP_URL`, `AUTH_URL`, and `NEXT_PUBLIC_APP_URL` must identify the same origin. Production uses one canonical public HTTPS origin.

### 7.3 Realtime values for the attached local server

```dotenv
REALTIME_TICKET_SIGNING_KEY=<unique-32-plus-character-secret>
REALTIME_TICKET_REDEMPTION_KEY=<different-32-plus-character-secret>
REALTIME_ISSUER=fabric-web
REALTIME_AUDIENCE=fabric-realtime
REALTIME_REVOCATION_ENDPOINT=http://localhost:8787/internal/revocations
REALTIME_COORDINATOR_SECRET=<unique-32-plus-character-secret>
REALTIME_REVOCATION_DISPATCH_SECRET=<different-32-plus-character-secret>
```

The signing and redemption keys must differ. The coordinator and dispatch secrets must also differ.

### 7.4 Environment ownership

| Variables | Runtime | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_REALTIME_URL` | Browser build | Public by design; never put credentials in `NEXT_PUBLIC_*` |
| OAuth values, `AUTH_SECRET`, `DATABASE_URL` | Next.js web | Server-only |
| `DATABASE_URL_DIRECT` | Migration process | Direct DDL-capable URL; never a runtime secret |
| `REALTIME_DATABASE_URL`, redemption key | Attached Node realtime | Not used by Cloudflare |
| Signing key, issuer, audience | Web and realtime | Values must match across the ticket issuer and verifier |
| Coordinator secret | Web and Cloudflare Worker | Shared only for protected revocation delivery |
| R2 S3 credentials | Next.js web | Server-only; use a bucket-scoped key |
| `WORKER_DATABASE_URL`, AI provider values | AI worker | Server-only |
| Health and cleanup secrets | Scheduler/operator | Distinct bearer credentials |

The complete variable list and safe placeholders live in [`.env.example`](../.env.example).

### 7.5 Workspace rollout

For local development, leaving `FABRIC_WORKSPACE_ROLLOUT_MODE` blank enables the workspace features. Production defaults to `off` when the value is omitted; follow the staged rollout process in the [production runbook](production-runbook.md#staging-canary-and-gradual-activation).

## 8. Run Fabric locally

Start the complete attached runtime:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The command starts:

- Next.js pages and APIs
- the PostgreSQL-backed Yjs WebSocket runtime at `ws://localhost:3000/realtime`
- the AI worker, even when AI runs are disabled

That last point is important: `WORKER_DATABASE_URL` and syntactically valid AI configuration are required for startup. The public `.env.example` provides an inert, disabled provider configuration; replace it only when enabling Fabric agent.

### Local smoke test

1. Open `http://localhost:3000/api/health/live` and expect `200`.
2. Sign in with Google and GitHub in separate browser profiles.
3. Complete onboarding and create a workspace.
4. Create a board and open it in both profiles.
5. Draw, move, and edit in both windows.
6. Disconnect one profile briefly, edit, reconnect, and verify recovery.

Stop the server with `Ctrl+C` so its attached runtimes drain cleanly.

## 9. Run Cloudflare realtime locally

This mode keeps the Next.js app at port 3000 but sends browser WebSockets to Wrangler at port 8787.

### 9.1 Create local Worker secrets

Copy the tracked template:

```bash
cp .dev.vars.example .dev.vars.dev
```

PowerShell:

```powershell
Copy-Item .dev.vars.example .dev.vars.dev
```

Set:

```dotenv
REALTIME_TICKET_SIGNING_KEY=<same-value-used-by-the-web-app>
REALTIME_COORDINATOR_SECRET=<same-coordinator-value-used-by-the-web-app>
```

`.dev.vars.dev` is ignored by Git.

### 9.2 Point the browser at Wrangler

Override these values in `.env.local`:

```dotenv
NEXT_PUBLIC_REALTIME_URL=ws://localhost:8787/realtime
REALTIME_REVOCATION_ENDPOINT=http://localhost:8787/internal/revocations
```

The Worker URL must end exactly in `/realtime`. Fabric adds the board and document-generation IDs itself.

### 9.3 Start both runtimes

Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npx wrangler dev --config wrangler.toml --env dev --port 8787
```

The Cloudflare Worker receives no Neon URL and no R2 credential. Its room state, ticket redemptions, snapshots, and revocation fences live in local Durable Object SQLite storage.

## 10. Configure private Cloudflare R2

R2 is optional for a first local boot, but it is required for board uploads, video, and custom avatars.

### 10.1 Create private buckets

Use one bucket for both logical stores or create separate buckets:

```bash
npx wrangler login
npx wrangler whoami
npx wrangler r2 bucket create your-fabric-media
npx wrangler r2 bucket list
```

Keep the bucket private. Do not enable `r2.dev` public access or a public custom domain for board media.

### 10.2 Create a bucket-scoped S3 credential

In Cloudflare, open **R2 > Manage API tokens**, create a token with object read/write access, and scope it to only the Fabric bucket. Cloudflare's current process is documented in [R2 S3 credentials](https://developers.cloudflare.com/r2/get-started/s3/).

Cloudflare displays three different values. Map them carefully:

| Cloudflare value | Fabric variable |
| --- | --- |
| Account ID | `FABRIC_R2_ACCOUNT_ID` |
| Access Key ID | `FABRIC_R2_ACCESS_KEY_ID` |
| Secret Access Key | `FABRIC_R2_SECRET_ACCESS_KEY` |

The API **token value is not the S3 Access Key ID** and is not used by Fabric's S3 client.

```dotenv
FABRIC_R2_ACCOUNT_ID=<32-hex-character-account-id>
FABRIC_R2_ACCESS_KEY_ID=<s3-access-key-id>
FABRIC_R2_SECRET_ACCESS_KEY=<s3-secret-access-key>
FABRIC_R2_BOARD_ASSET_BUCKET=your-fabric-media
FABRIC_R2_AVATAR_BUCKET=your-fabric-media
FABRIC_R2_PRESIGN_TTL_SECONDS=300
```

The S3 endpoint is derived from the account ID. Do not add an R2 endpoint or credential to a `NEXT_PUBLIC_*` variable.

### 10.3 Apply exact-origin CORS

For local development:

```bash
npx wrangler r2 bucket cors set your-fabric-media --file cloudflare/r2-cors.local.example.json
npx wrangler r2 bucket cors list your-fabric-media
```

For production, first replace the origin in `cloudflare/r2-cors.production.json`, then apply it:

```bash
npx wrangler r2 bucket cors set your-fabric-media --file cloudflare/r2-cors.production.json
npx wrangler r2 bucket cors list your-fabric-media
```

Browser presigned uploads still require CORS. See Cloudflare's [R2 CORS documentation](https://developers.cloudflare.com/r2/buckets/cors/).

Do not add a broad lifecycle deletion rule for `boards/` or `avatars/`; those prefixes contain finalized objects as well as staged work. Fabric's cleanup outbox is the authoritative deletion path.

## 11. Configure the Fabric agent

Fabric agent is disabled in the public example environment so a contributor can boot the stack without a paid model account.

To enable it, configure an HTTPS OpenAI-compatible base URL. Fabric appends `/chat/completions`, so the base normally ends at `/v1`:

```dotenv
AI_PROVIDER=openai-compatible
AI_RUNS_ENABLED=true
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=<server-only-provider-key>
AI_MODEL=<provider-model-id>
AI_STREAM_ONLY=true
```

For managed rotation/failover, replace `AI_API_KEY` with a comma-separated, newline-separated, or JSON-array `AI_API_KEYS` value. Never expose either variable to the browser.

The attached AI worker always uses `WORKER_DATABASE_URL`. On Vercel, the bounded serverless dispatcher may use `DATABASE_URL` when a separate worker URL is not configured.

If a provider accepts the request but does not implement compatible streaming Chat Completions behavior, Fabric will fail safely rather than apply an unvalidated board change.

## 12. Deploy Cloudflare realtime

Fabric's production Worker contains two SQLite Durable Object classes:

- `FabricBoardRoom`
- `WorkspaceAccessCoordinator`

The committed bindings and additive migration history are in `wrangler.toml`. Do not rename or delete the classes, bindings, migration tags, or existing storage during an upgrade or rollback.

### 12.1 Prepare the configuration

For a fork, complete [Configure your fork](#4-configure-your-fork) first. Confirm that the production allowlist contains only the canonical HTTPS app origin; localhost belongs only in `[env.dev]`.

### 12.2 Run Worker gates

```bash
npm run realtime:worker:typecheck
npm run realtime:worker:test
npm run realtime:worker:types
npx wrangler deploy --config wrangler.toml --dry-run
```

### 12.3 Authenticate and deploy

```bash
npx wrangler login
npx wrangler whoami
npx wrangler deploy --config wrangler.toml
```

For a first deployment, this provisions the committed SQLite Durable Object namespaces.

### 12.4 Add Worker secrets

Use Wrangler's protected interactive prompt. Do not pass secrets as command arguments.

```bash
npx wrangler secret put REALTIME_TICKET_SIGNING_KEY --config wrangler.toml
npx wrangler secret put REALTIME_COORDINATOR_SECRET --config wrangler.toml
```

The signing value must exactly match the web runtime's `REALTIME_TICKET_SIGNING_KEY`. The coordinator value must exactly match the web runtime's `REALTIME_COORDINATOR_SECRET`.

### 12.5 Verify Worker health

```bash
curl --fail --silent --show-error https://your-worker-host/health
```

Expected shape:

```json
{
  "status": "ok",
  "transport": "cloudflare-durable-objects"
}
```

Do not point the web application at the Worker until health succeeds. For existing-room cutover, smoke tests, rollback, and secret rotation, follow the [Cloudflare realtime operations guide](../cloudflare/realtime/README.md).

## 13. Deploy the web application

Vercel is the reference Next.js host. Another compatible Node/Next.js host can work, but you must preserve the same runtime and secret boundaries.

### 13.1 Set the canonical production origin

These must all be the same HTTPS origin and must match `lib/site.ts`:

```dotenv
FABRIC_ENV=production
NEXT_PUBLIC_APP_URL=https://your-domain.example
APP_URL=https://your-domain.example
AUTH_URL=https://your-domain.example
REALTIME_ALLOWED_ORIGINS=https://your-domain.example
```

Register the exact OAuth callbacks from [section 6](#6-configure-google-and-github-oauth).

### 13.2 Connect the deployed Worker

```dotenv
NEXT_PUBLIC_REALTIME_URL=wss://your-worker-host/realtime
REALTIME_REVOCATION_ENDPOINT=https://your-worker-host/internal/revocations
REALTIME_TICKET_SIGNING_KEY=<same-as-worker>
REALTIME_COORDINATOR_SECRET=<same-as-worker>
REALTIME_ISSUER=fabric-web
REALTIME_AUDIENCE=fabric-realtime
```

`NEXT_PUBLIC_REALTIME_URL` is embedded into the browser build. Redeploy the web application after changing it.

### 13.3 Recommended release order

1. Create a Neon restore point.
2. Apply committed database migrations and grants.
3. Configure private R2 and exact-origin CORS.
4. Deploy and health-check Cloudflare realtime.
5. Configure the web environment and OAuth callbacks.
6. Build and deploy Next.js.
7. Keep the workspace rollout off until staging smoke tests pass.
8. Enable one canary workspace, observe it, then expand deliberately.

Before the web deploy:

```bash
npm ci
npm run verify
npm run db:check
npm audit --omit=dev
git diff --check
```

Read the [production runbook](production-runbook.md) before enabling a public environment.

## 14. Configure scheduled maintenance

Fabric exposes two protected same-origin maintenance routes:

| Route | Credential | Purpose |
| --- | --- | --- |
| `/api/internal/media-cleanup` | `MEDIA_CLEANUP_SECRET` | Reconcile abandoned uploads and object deletions |
| `/api/internal/realtime-revocations` | `REALTIME_REVOCATION_DISPATCH_SECRET` | Deliver permission reductions to active rooms |

Use a scheduler supported by your host. Send the matching bearer credential in the `Authorization` header, keep the two credentials distinct, and alert on repeated failures. The realtime revocation dispatcher should run frequently enough that membership removals and role downgrades reach active rooms promptly; the production runbook defines the current operating expectation.

## 15. Verify the installation

### 15.1 Repository gates

```bash
npm run verify
npm run db:check
npm audit --omit=dev
npm run realtime:worker:types
npx wrangler deploy --config wrangler.toml --dry-run
npx wrangler deploy --config wrangler.toml --env dev --dry-run
git diff --check
```

### 15.2 Two-profile product smoke test

- Google and GitHub sign-in complete on the canonical origin.
- A new user can finish onboarding and create a workspace.
- Owners can invite a second account.
- Both accounts can open the same board and see live changes and presence.
- A viewer cannot write.
- Reconnect and a second tab preserve queued edits without a ticket/socket storm.
- Comments, checkpoints, archive/restore, and share links retain tenant scope.
- Image/video upload succeeds and remains inaccessible without board access.
- Fabric agent streams a proposal and changes nothing until a person applies it.
- Removing or downgrading a collaborator reauthorizes or closes the affected socket.

## 16. Troubleshooting

### `npm run dev` cannot connect to PostgreSQL

- Confirm all four database URLs are present.
- Use pooled `-pooler` hosts for web, realtime, and worker runtimes.
- Use a direct non-pooler host for `DATABASE_URL_DIRECT`.
- Apply migrations, then the least-privilege grant block.
- Confirm each role can connect to the selected database and branch.

### Google reports `redirect_uri_mismatch`

The callback registered in Google must exactly match the origin in `APP_URL`, `AUTH_URL`, `NEXT_PUBLIC_APP_URL`, and `lib/site.ts`. For local development it is:

```text
http://localhost:3000/api/auth/callback/google
```

### GitHub redirects to the wrong host

Update the GitHub OAuth app's authorization callback URL and confirm the production `SITE_URL` was changed before building. Clear old preview-domain environment values and redeploy.

### `/api/realtime/ticket` returns `403`

- The request origin must be the exact canonical app origin.
- The signed-in account must have effective board access.
- The board cannot be archived or in a replaced generation.
- Check `lib/site.ts`, the web environment, and `wrangler.toml` for stale domains.

### Ticket returns `200` but collaboration stays offline

- Confirm `NEXT_PUBLIC_REALTIME_URL` uses `ws:` or `wss:` and ends exactly in `/realtime`.
- Rebuild after changing the public realtime URL.
- Ensure the signing key, issuer, and audience match between web and Worker.
- Check the Worker `/health` response.
- Confirm the Worker's origin allowlist contains the browser's exact origin.

### Wrangler Worker health returns `503`

- Add both required Worker secrets.
- Confirm both Durable Object bindings exist.
- Confirm production origins use HTTPS.
- Regenerate binding types after changing literal Wrangler variables.

### R2 upload returns `403` or fails in the browser

- Use the S3 **Access Key ID**, not the API token value.
- Confirm the key is scoped to the configured bucket.
- Confirm both logical bucket names are correct.
- Apply exact-origin PUT CORS and inspect it with `wrangler r2 bucket cors list`.
- Keep the bucket private; Fabric reads through authorized same-origin routes.

### Fabric agent is unavailable

- Confirm `AI_RUNS_ENABLED=true` only after configuring a real provider.
- `AI_BASE_URL` must be a credential-free HTTPS base and must not include `/chat/completions`.
- Configure either `AI_API_KEY` or `AI_API_KEYS`.
- Confirm the model identifier is accepted by the provider.
- Confirm `WORKER_DATABASE_URL` has the AI grants.
- Check provider quota and streaming Chat Completions compatibility.

### `patch-package` or the tldraw invariant fails

Run `npm ci` with Node 22 and the committed lockfile. Do not upgrade tldraw or regenerate `patches/@tldraw+editor+4.2.0.patch` as a setup workaround.

## 17. Updating and rollback

Before updating:

1. Read new migrations and Worker binding changes.
2. Create a Neon restore point.
3. Run the full verification suite.
4. Deploy backward-compatible database/API changes first.
5. Deploy Worker code without deleting or renaming Durable Object storage.
6. Use staging and one canary workspace before broad enablement.

During an incident, roll Worker code back **in place**. Never delete either Durable Object class, its binding, migration history, or room data. Do not run destructive database down migrations. The detailed procedures are in:

- [Cloudflare realtime rollback](../cloudflare/realtime/README.md#safe-rollback)
- [Production backups, rollout, and incidents](production-runbook.md)

---

If a setup step is unclear or fails reproducibly, open a GitHub issue with the operating system, Node/npm versions, the failing command, and a redacted error. Never include environment values, database URLs, tokens, tickets, object keys, or presigned URLs.

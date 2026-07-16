# Fabric realtime on Cloudflare

Production realtime is split from the Vercel application runtime:

```text
Browser
  |-- HTTPS --> Vercel / Next.js (auth, board APIs, ticket minting)
  `-- WSS ----> Cloudflare Worker -> one Durable Object per board generation
Vercel revocation dispatcher ----> workspace coordinator Durable Object
                                      `-> affected board-generation rooms
```

Vercel authenticates the user, checks board membership, and signs a short-lived
room ticket. The browser sends that ticket as the first WebSocket frame; it is
never placed in the URL. The Durable Object verifies the ticket, redeems its
`jti` once, persists Yjs updates in SQLite-backed storage, and broadcasts Yjs
updates and ephemeral awareness to the room.

The strict TypeScript implementation is in `cloudflare/realtime/worker.ts`. Its binding, public
variables, and initial SQLite-class migration are in the repository-root
`wrangler.toml`.

## Required configuration

Use a separate Cloudflare Worker for each application environment. Production
and preview must not share Durable Objects, signing keys, or origin allowlists.

| Setting | Vercel | Cloudflare Worker | Rule |
| --- | --- | --- | --- |
| Canonical app origin | `APP_URL`, `AUTH_URL`, `NEXT_PUBLIC_APP_URL` | `REALTIME_ALLOWED_ORIGINS` | Use the exact HTTPS origin, without a path or wildcard. |
| Worker WebSocket base URL | `NEXT_PUBLIC_REALTIME_URL` | n/a | `wss://<worker-host>/realtime`; the client adds board and generation UUIDs. |
| Ticket signing key | `REALTIME_TICKET_SIGNING_KEY` | `REALTIME_TICKET_SIGNING_KEY` secret | The same 32-or-more-character random value on both runtimes. Never put it in `wrangler.toml`. |
| Ticket issuer | `REALTIME_ISSUER` | `REALTIME_ISSUER` | Values must match exactly; the committed default is `fabric-web`. |
| Ticket audience | `REALTIME_AUDIENCE` | `REALTIME_AUDIENCE` | Values must match exactly; the committed default is `fabric-realtime`. |
| Revocation delivery URL | `REALTIME_REVOCATION_ENDPOINT` | n/a | Exact Worker HTTPS URL ending in `/internal/revocations`; server-only. |
| Revocation dispatch credential | `REALTIME_REVOCATION_DISPATCH_SECRET` | n/a | Distinct 32+ character bearer secret protecting the bounded Vercel cron route. |
| Coordinator credential | `REALTIME_COORDINATOR_SECRET` | `REALTIME_COORDINATOR_SECRET` secret | Same 32+ character value on these two server runtimes; it must differ from signing and dispatch secrets. |
| Web database | `DATABASE_URL` | n/a | Vercel uses it for membership checks and ticket-mint rate limits. |
| Durable Object binding | n/a | `FABRIC_BOARD_ROOMS` | Keep the class name `FabricBoardRoom` and the committed migration tag. |
| Access coordinator binding | n/a | `FABRIC_ACCESS_COORDINATORS` | Keep `WorkspaceAccessCoordinator` and additive migration tag `v2`; never delete its storage during rollback. |
| Deployment mode | n/a | `FABRIC_ENV=production` | Production health rejects insecure localhost origins. |

`REALTIME_DATABASE_URL` and `REALTIME_TICKET_REDEMPTION_KEY` belong to the
legacy/custom-Node realtime server. The Cloudflare Worker does not need either
value: update persistence and ticket redemption live in each Durable Object.

Before a production deploy, ensure the production `REALTIME_ALLOWED_ORIGINS`
value in `wrangler.toml` contains only the canonical production app origin.
Do not leave `http://localhost:3000` in the production allowlist. The committed
`env.dev` section isolates the local origin; select it explicitly for local
Wrangler development. Put the same local signing key used by Next.js in the
ignored `.dev.vars.dev` file as `REALTIME_TICKET_SIGNING_KEY=<value>` and a
different `REALTIME_COORDINATOR_SECRET=<value>`, then run:

```powershell
npx --yes wrangler@4.110.0 dev --config wrangler.toml --env dev
```

Before every Worker dry-run or deployment, run the generated-binding check and
the real Cloudflare runtime suite:

```powershell
npm run realtime:worker:typecheck
npm run realtime:worker:test
npm run realtime:worker:types
```

## Runtime durability and bounds

- Each board ID plus document-generation ID maps to one Durable Object.
- Yjs updates and snapshots use the committed bounded protocol limits. Payloads
  are stored in 768 KiB SQLite chunks, below the per-row limit.
- A snapshot is persisted every 128 committed updates. Compacted update payload
  chunks are deleted after the snapshot commits.
- Idempotency receipts are retained for at least the latest 4,096 messages and
  otherwise for 30 days, so retry safety does not require retaining old payloads.
- Permission-reducing mutations write `realtime_revocation_outbox` in the same
  Neon transaction. A bounded, protected dispatcher pages workspace/project
  events into concrete rooms. Each room persists the event receipt and ticket
  fence before closing the affected principal; retries are idempotent and do
  not run on the accepted-edit path.
- A socket lease never extends beyond the current ticket expiry. The browser
  silently mints a replacement 10–15 seconds early with jitter and refreshes
  authorization in-band without reconnecting or downloading another snapshot.
  Transient refresh failure leaves editing and the durable outbox active until
  the current authorization actually expires.
- Tabs for the same principal and board generation coordinate with Web Locks
  and BroadcastChannel so one owner tab holds the socket while follower tabs
  relay accepted local changes without creating a ticket/socket storm.
- Authenticated update frequency, bytes, handler time, and fan-out are emitted
  as shadow telemetry. Legitimate edit traffic is not rejected by a low
  per-user or per-IP update-rate ceiling.
- Awareness is ephemeral: it is broadcast over sockets and retained only in a
  bounded socket attachment for late joiners. It is never written to Durable
  Object SQLite or Neon.
- Worker observability is enabled with 10 percent head sampling. Alerts still
  require Cloudflare log/metric configuration outside this repository.

## First deployment

The commands below are PowerShell commands run from the repository root. They
pin the CLI version used to validate this runbook. Authentication is interactive
so no token is placed in shell history.

1. Authenticate and verify the intended Cloudflare account:

   ```powershell
   npx --yes wrangler@4.110.0 login
   npx --yes wrangler@4.110.0 whoami
   ```

2. Review `wrangler.toml`, then compile without changing remote state:

   ```powershell
   npx --yes wrangler@4.110.0 deploy --config wrangler.toml --env="" --dry-run
   ```

3. Deploy the unreferenced Worker and its initial `new_sqlite_classes`
   migration. At this point no Vercel build points to it, and WebSocket
   authentication fails closed because the signing secret is not present:

   ```powershell
   npx --yes wrangler@4.110.0 deploy --config wrangler.toml --env=""
   ```

4. Create one random signing key and a different random coordinator key in the
   approved secret manager. Add them to Cloudflare through Wrangler's protected
   prompts; do not pass either value with
   `--var`, `--value`, or as a command-line argument. Do not configure Vercel's
   Worker URL until this succeeds:

   ```powershell
   npx --yes wrangler@4.110.0 secret put REALTIME_TICKET_SIGNING_KEY --config wrangler.toml --env=""
   npx --yes wrangler@4.110.0 secret put REALTIME_COORDINATOR_SECRET --config wrangler.toml --env=""
   npx --yes wrangler@4.110.0 deployments list --config wrangler.toml --env=""
   ```

   Record the deployment/version ID and Worker hostname in the release record.

5. Verify the Worker before pointing browsers at it:

   ```powershell
   curl.exe --fail --silent --show-error https://<worker-host>/health
   ```

   The response must be JSON with `status: "ok"` and transport
   `cloudflare-durable-objects`. A `503` means the signing key, issuer, audience,
   production origin policy, or Durable Object binding is not ready; do not
   continue to Vercel configuration.

6. Link the local checkout to the correct Vercel project and add the production
   values through interactive prompts. Paste the same signing key configured in
   Cloudflare in step 4 when prompted for `REALTIME_TICKET_SIGNING_KEY`.

   ```powershell
   npx --yes vercel@56.1.0 login
   npx --yes vercel@56.1.0 link
   npx --yes vercel@56.1.0 env add NEXT_PUBLIC_REALTIME_URL production
   npx --yes vercel@56.1.0 env add REALTIME_TICKET_SIGNING_KEY production --sensitive
   npx --yes vercel@56.1.0 env add REALTIME_ALLOWED_ORIGINS production
   npx --yes vercel@56.1.0 env add REALTIME_ISSUER production
   npx --yes vercel@56.1.0 env add REALTIME_AUDIENCE production
   npx --yes vercel@56.1.0 env add REALTIME_REVOCATION_ENDPOINT production --sensitive
   npx --yes vercel@56.1.0 env add REALTIME_COORDINATOR_SECRET production --sensitive
   npx --yes vercel@56.1.0 env add REALTIME_REVOCATION_DISPATCH_SECRET production --sensitive
   ```

   Enter `wss://<worker-host>/realtime` for `NEXT_PUBLIC_REALTIME_URL` and the
   exact canonical Vercel HTTPS origin for `REALTIME_ALLOWED_ORIGINS`. Configure
   `APP_URL`, `AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`, and the normal
   authentication/AI variables described in `docs/production-runbook.md`.

7. Build and deploy Vercel only after all values are present. The public
   realtime URL is embedded during the Next.js build, so an environment change
   without a new deployment does not change existing browser bundles.

   ```powershell
   npm ci
   npm run verify
   npx --yes vercel@56.1.0 deploy --prod
   ```

## Existing-room cutover gate

The first Durable Object deployment does not import legacy Neon
`realtime_updates`. Do not change `NEXT_PUBLIC_REALTIME_URL` while people are
editing on the old transport.

For an existing environment, schedule a short maintenance window, wait for all
boards to show `Saved`, stop active editors, create a Neon restore point, and
verify the board documents contain the expected latest work before the Vercel
deployment. Preserve the legacy realtime tables during the observation window.
If any room has updates newer than its saved board document, stop the cutover
and migrate or checkpoint that room first; local browser state is not a
production migration strategy.

## Post-deploy smoke test

Use two non-admin accounts in separate browser profiles:

1. Confirm `GET https://<app-host>/api/health/live` and
   `GET https://<worker-host>/health` return `200`.
2. Confirm the protected `GET https://<app-host>/api/health/ready` returns
   topology `vercel-serverless`, realtime `external-ready`, and AI
   `serverless-ready` when called with the readiness bearer secret.
3. Open the same board in both profiles. Confirm the authenticated
   `POST /api/realtime/ticket` returns `200` without repeated minting.
4. Confirm the WebSocket connects to
   `wss://<worker-host>/realtime/<board-id>/<generation-id>`, not the Vercel
   `/realtime` path, and that no credential appears in its URL.
5. Create, move, resize, and edit objects in both profiles. Confirm each peer
   receives changes and presence without a page refresh.
6. Refresh both profiles, open a second tab, then disconnect/reconnect one
   profile. Confirm board recovery, one owner socket per tab group, silent
   ticket refresh, and no persistent ticket or database request loop.
7. Confirm viewer/commenter roles cannot send board updates.
8. With a second owner account, downgrade/remove one test collaborator and run
   one authenticated `GET /api/internal/realtime-revocations` pass. Confirm the
   targeted socket reauthorizes or becomes read-only, another principal stays
   connected, and the local recovery journal remains available.

## Safe rollback

Do not delete the Worker, either Durable Object binding/class, any migration
tag, coordinator state, or room storage during an incident. A code rollback
must preserve the SQLite-backed rooms and access coordinators.

1. List deployments and select the last known-good Worker version:

   ```powershell
   npx --yes wrangler@4.110.0 deployments list --config wrangler.toml --env=""
   ```

2. Roll back Worker code in place. The command prompts for confirmation:

   ```powershell
   npx --yes wrangler@4.110.0 rollback <known-good-worker-version-id> --config wrangler.toml --env=""
   ```

3. Recheck Worker health and repeat the two-browser smoke test:

   ```powershell
   curl.exe --fail --silent --show-error https://<worker-host>/health
   ```

4. If the fault is in the Vercel release, keep the compatible Worker version
   deployed and roll the app back to the recorded Vercel deployment:

   ```powershell
   npx --yes vercel@56.1.0 rollback <known-good-vercel-deployment-id-or-url>
   ```

Do not point a live room back to the legacy Neon WebSocket server after clients
have written to Durable Objects unless a tested reverse-migration reconciles
both stores. If no compatible Worker version exists, leave clients in their
local/offline recovery state, preserve both stores, and repair the Worker in
place instead of resetting room data.

## Secret rotation

The current ticket verifier accepts one signing key. Rotate during a maintenance
window: stop new editors, update the Worker secret through the protected prompt,
update the Vercel secret with the same value, redeploy Vercel, then reconnect
clients. Existing sockets remain bounded by their current short lease and will
refresh or reauthenticate against the new key. Never
print, commit, or copy the key into a public variable.

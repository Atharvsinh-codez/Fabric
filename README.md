# Fabric

Fabric is a persistent multiplayer design canvas built with Next.js 16, React 19, Tailwind CSS v4, tldraw, Yjs, Auth.js, Neon/PostgreSQL, Cloudflare Durable Objects and R2, and streamed OpenAI-compatible canvas proposals.

Production uses a Next.js App Router deployment for pages and authenticated APIs, a Cloudflare Worker with one SQLite Durable Object per board generation for realtime collaboration, private R2 buckets for uploaded media, and Neon for identity, tenant metadata, recovery checkpoints, and durable product state. `server.ts` remains the attached local-development runtime and is not the Vercel production entrypoint.

The implemented product path includes Google and GitHub sign-in, database sessions, onboarding, tenant-scoped workspaces and projects, effective board permissions, favorites and pins, board lifecycle status, archive/restore, persistent boards, a Fabric-blue tldraw editor, multiplayer presence and document sync, offline recovery, comments, scoped share links, checkpoints, private image/video assets, custom avatars, and review-before-apply AI proposals.

## Runtime and database boundaries

Production separates runtime credentials and responsibilities:

| Runtime | Responsibility | Credential/storage boundary |
| --- | --- | --- |
| Next.js web | UI, Auth.js, tenant-aware APIs, AI SSE delivery, ticket issuance, media authorization, and proposal approval | `DATABASE_URL` as `fabric_web` plus a dedicated R2 S3 credential |
| Cloudflare realtime Worker | Scoped WebSockets, ordered Yjs persistence, awareness, and ticket redemption | Durable Object SQLite; no Neon or R2 credential |
| AI worker/dispatcher | Durable leases, OpenAI-compatible streaming, validation, retries, cancellation, and retention | `WORKER_DATABASE_URL` as `fabric_worker` when separately attached |
| R2 | Private board media and custom avatar bytes | Dedicated private buckets; metadata and authorization remain in Neon |

`DATABASE_URL_DIRECT` uses the DDL-capable `fabric_migrator` identity only for ordered migrations. The browser never receives OAuth secrets, database URLs, AI provider credentials, health credentials, or realtime keys. `NEXT_PUBLIC_*` values are intentionally browser-visible build inputs.

## Local development

Prerequisites: Node.js 22, npm, a PostgreSQL/Neon database, Google and GitHub OAuth applications, and a server-only key for an OpenAI-compatible streaming endpoint.

```powershell
npm ci
Copy-Item .env.example .env
```

Replace every placeholder in `.env` or an ignored `.env.local` override. Never copy real values back into `.env.example`. Use pooled Neon hostnames for runtime URLs and a direct hostname for `DATABASE_URL_DIRECT`. Use a dedicated, least-privilege R2 S3 key, keep both buckets private with public URLs disabled, and configure exact-origin browser PUT CORS as documented in the production runbook.

The Vercel serverless deployment may omit `WORKER_DATABASE_URL`; its bounded on-demand AI dispatcher then uses the existing `DATABASE_URL` role, which already has the AI table grants. Attached/local worker runtimes continue to require the distinct worker credential.

Apply the committed schema:

```powershell
npm run db:check
npm run db:migrate
```

Start the complete local application with one command:

```powershell
npm run dev
```

Open `http://localhost:3000`. The browser, OAuth callbacks, API requests, and `ws://localhost:3000/realtime` all use this origin. `npm run dev` is for local development only.

## Production validation

Run the repository gate before release:

```powershell
npm run verify
npm run db:check
npm audit --omit=dev
git diff --check
```

`npm run verify` checks the pinned tldraw invariant, application and Cloudflare runtime tests, application/realtime/AI TypeScript, ESLint, and the production build.

## Build and start

Set final public build inputs before building, then compile the web application:

```powershell
npm ci
npm run build
npm run start
```

The application has one canonical public HTTPS origin. `NEXT_PUBLIC_REALTIME_URL` points to the deployed Cloudflare Worker `/realtime` base, not to Vercel.

Read [the production runbook](docs/production-runbook.md) before deployment. It covers Neon migrations and grants, OAuth callbacks, environment boundaries, the unified startup lifecycle, health checks, rollback, monitoring, and retention.

Do not commit `.env`, `.env.local`, provider keys, database URLs, or generated backup files.

## Current operational limits

- Realtime room state is Durable Object SQLite; preserve the existing class, binding, and room storage during deployments and rollback.
- Authenticated update traffic is observed in shadow mode. Fabric does not impose low per-user/IP edit-rate limits; malformed, corrupt, impossible, or unsafe slow-consumer traffic can still be rejected.
- Private R2 uploads support PNG, JPEG, GIF, and WebP images up to 5 MiB and MP4/WebM videos up to 50 MiB, with a 1 GiB/1,000-asset technical board quota.
- Media deletion and abandoned-upload cleanup require the protected cleanup endpoint to be scheduled and monitored. Do not apply a broad R2 expiration rule to `boards/` or `avatars/`; final objects share those prefixes with staging objects.
- AI proposals require `AI_RUNS_ENABLED=true`; provider quota or availability can still prevent completion.
- OAuth applications, canonical HTTPS configuration, Neon protection, secret rotation, alerting, staging, selecting/observing the server-enforced canary workspace, and restore drills remain operator responsibilities.

## Visual assets

- `public/images/fabric-meadow-hero-v3.webp`
- `public/images/fabric-evidence-sky-v4.webp`
- `public/images/fabric-hills-reference-v3.webp`

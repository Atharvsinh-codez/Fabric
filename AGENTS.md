# Fabric Engineering Guide

## Read this first

- Read `Context.md` before changing code, configuration, migrations, or documentation.
- Append one new entry to `Context.md` after finishing a coherent change. Never rewrite or remove older entries.
- Preserve unrelated user changes in the working tree. Do not reset, discard, or overwrite them.
- Use Node.js 22 and the committed npm lockfile.

## Product and runtime architecture

Fabric is a persistent, local-first multiplayer whiteboard built with Next.js 16, React 19, TypeScript, tldraw 4.2, Yjs, Auth.js, Drizzle, Neon PostgreSQL, and Cloudflare Workers/Durable Objects.

Production is split into these trust boundaries:

- Vercel: Next.js pages, Auth.js, tenant-aware HTTP APIs, realtime ticket minting, and AI request dispatch.
- Cloudflare: the deployed realtime Worker and one SQLite Durable Object room per board document generation. Media Workers must be deployed separately from realtime.
- Neon: identity, workspaces, projects, boards, permissions, recovery checkpoints, comments, asset metadata, and AI state.
- Browser: tldraw/Yjs state, IndexedDB recovery, and the durable realtime outbox. Browser claims are never authorization.

`server.ts` composes the attached local runtime. It is not the production Vercel entrypoint. Changes to deployed realtime belong under `cloudflare/realtime/`; changes to the attached development WebSocket server belong under `realtime/`.

## Security and tenant rules

- Treat every workspace, project, board, generation, share token, upload, and realtime frame as untrusted input.
- Authorize resources through the centralized effective-access resolver. Do not authorize from a client-supplied role or workspace alone.
- Scope board listings and mutations to one explicit workspace. Never return multiple tenants for browser-side filtering.
- Return the same not-found response for absent and inaccessible tenant resources unless a documented public contract requires otherwise.
- Validate external input with Zod, enforce byte/count bounds before expensive work, and require same-origin checks for authenticated browser mutations.
- Keep service credentials server-only. Never add secrets to source, Wrangler variables, logs, fixtures, `NEXT_PUBLIC_*`, command arguments, or `Context.md`.
- Use separate signing keys and least-privilege credentials for auth, realtime, assets, migrations, and AI.
- R2 buckets containing board media are private. Persist stable Fabric API URLs in board documents; never persist presigned URLs, share tokens, object keys, or provider credentials in tldraw/Yjs state.
- Accepted local edits must survive transient network or load failures in the durable outbox. Do not add low authenticated-user/IP edit limits. Measure first, keep monitoring in shadow mode, and prefer backpressure/batching/retry.

## tldraw freeze

- Keep `tldraw` pinned exactly to `4.2.0`.
- Do not edit, remove, regenerate, or bypass `patches/@tldraw+editor+4.2.0.patch` without explicit user approval and a licensing review.
- Do not modify tldraw internals for Fabric features. Use the public editor, asset-store, external-content, and component APIs.
- Any dependency install must run `postinstall` successfully and CI must prove the pinned version and patch still exist.

## Code conventions

- Keep strict TypeScript boundaries. Avoid `any`, unsafe double casts, and hand-written Cloudflare binding types when Wrangler can generate them.
- Mark browser modules with `"use client"`, server actions with `"use server"`, and server-only libraries with `import "server-only"`.
- Prefer typed domain errors, immutable inputs, explicit return types at trust boundaries, and small repositories/services over route-local persistence logic.
- Await required writes. Use `ctx.waitUntil()` only for non-critical Worker follow-up work. Never keep request-specific mutable state at module scope.
- Stream large media and Worker responses; do not buffer unbounded request or response bodies.
- Keep tests colocated as `*.test.ts` or `*.test.tsx`.

## Database and migration policy

- Schema changes are additive and backward-compatible during rollout.
- Generate and review committed Drizzle migrations; never edit an already deployed migration.
- Backfill tenant identifiers, owners, access policy, and status before making new columns required.
- Cross-system PostgreSQL/R2 work is not transactional. Reserve/finalize explicitly and use durable outboxes plus idempotent reconciliation for deletion and cleanup.
- Create a Neon restore point before production migrations. Do not run destructive down migrations in production.

## Required verification

Use focused checks while iterating, then run the full release gates from the repository root:

```text
npm test
npm run typecheck
npm run realtime:typecheck
npm run realtime:worker:typecheck
npm run realtime:worker:test
npm run realtime:worker:types
npm run ai-worker:typecheck
npm run lint
npm run build
npm run db:check
npm audit --omit=dev
npx wrangler deploy --dry-run
npx wrangler deploy --dry-run --env dev
git diff --check
```

`npm run verify` covers the pinned tldraw invariant, tests, application/realtime/Worker typechecks, the real Cloudflare runtime suite, lint, and build; run the generated Worker binding check above separately. Production rollout proceeds through staging with `FABRIC_WORKSPACE_ROLLOUT_MODE=off`, one exact allowlisted workspace in `canary`, and verified gradual enablement before `all`. Never bypass the server-enforced rollout with a browser flag or enable globally in place of canary verification.

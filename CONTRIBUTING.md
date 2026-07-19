# Contributing to Fabric

Thank you for helping improve Fabric. Contributions are welcome across the product, realtime collaboration, accessibility, documentation, tests, and developer experience.

## Before you start

1. Read the [setup guide](docs/setup.md).
2. Read [`AGENTS.md`](AGENTS.md) for architecture, security, migration, and verification rules.
3. Search existing [issues](https://github.com/Atharvsinh-codez/Fabric/issues) before opening a duplicate.
4. For a large feature or architectural change, open an issue first so the approach can be agreed before implementation.

Security vulnerabilities must not be reported in a public issue. Follow [SECURITY.md](SECURITY.md).

## Development workflow

```bash
git clone https://github.com/Atharvsinh-codez/Fabric.git
cd Fabric
npm ci
cp .env.example .env
```

Complete the environment and database steps in [docs/setup.md](docs/setup.md), then run:

```bash
npm run dev
```

Create a focused branch from current `main`:

```bash
git switch main
git pull --ff-only
git switch -c feat/short-description
```

Recommended prefixes are `feat/`, `fix/`, `docs/`, `test/`, `refactor/`, and `chore/`.

## Engineering expectations

- Keep tenant scope explicit and authorize through server-owned access resolution.
- Validate external input before expensive work and never trust browser role claims.
- Keep secrets server-only. Never commit `.env*`, tokens, database URLs, presigned URLs, or production identifiers copied from private systems.
- Preserve local-first behavior: accepted edits must survive transient network or load failures.
- Add or update colocated `*.test.ts` / `*.test.tsx` coverage for behavior changes.
- Keep database migrations additive, ordered, and backward compatible. Never edit a migration already deployed.
- Preserve accessibility, responsive behavior, reduced motion, and keyboard interaction.
- Avoid unrelated formatting or dependency churn in a focused change.

## Frozen tldraw boundary

Fabric pins `tldraw` exactly to `4.2.0` and carries a reviewed patch at `patches/@tldraw+editor+4.2.0.patch`.

Do not change the version, patch, editor internals, shape behavior, or watermark handling without explicit maintainer approval and a licensing review. Build Fabric features through tldraw's public editor, asset-store, external-content, and component APIs.

## Documentation and context log

Update public documentation when a change affects setup, behavior, configuration, deployment, or operations.

This repository also keeps an append-only engineering journal in `Context.md`. After a coherent change, add one entry describing the request, actions, files, validation, risks, and next steps. Do not rewrite older entries and never put secrets in the journal.

## Verification

Use focused checks while iterating. Before opening a pull request, run:

```bash
npm run verify
npm run db:check
npm audit --omit=dev
npm run realtime:worker:types
git diff --check
```

Changes to Cloudflare realtime should also pass both deployment dry-runs:

```bash
npx wrangler deploy --config wrangler.toml --dry-run
npx wrangler deploy --config wrangler.toml --env dev --dry-run
```

## Commits and pull requests

Use Conventional Commit subjects where practical:

```text
feat(boards): Add a shared navigation control
fix(realtime): Preserve queued edits during reconnect
docs(setup): Explain private R2 configuration
```

A good pull request:

- explains the user-visible outcome and motivation;
- describes important security, data, and migration effects;
- lists the checks that were run;
- includes screenshots or recordings for material UI changes;
- calls out follow-up work instead of hiding incomplete behavior;
- contains no secret, generated build output, or unrelated local file.

Maintainers may ask for a change to be split when independent concerns make review or rollback difficult.

## Getting help

For reproducible setup or product problems, open an [issue](https://github.com/Atharvsinh-codez/Fabric/issues/new) with:

- operating system;
- Node and npm versions;
- the exact command that failed;
- a minimal reproduction;
- redacted logs or screenshots.

Never include credentials, session cookies, signed tickets, private board content, presigned URLs, or database connection strings.

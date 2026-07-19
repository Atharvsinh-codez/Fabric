# Security policy

Fabric handles identity, tenant permissions, private board content, uploaded media, realtime collaboration, and AI provider access. Please report security problems privately and give maintainers reasonable time to investigate before disclosure.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Atharvsinh-codez/Fabric/security/advisories/new) when it is available for the repository.

If private reporting is unavailable, contact the repository owner through their [GitHub profile](https://github.com/Atharvsinh-codez) and request a private channel. Do not open a public issue containing exploit details, credentials, tenant data, or a working proof of concept.

Include only what is necessary:

- affected commit or deployment version;
- impacted route, component, or protocol;
- prerequisites and reproducible steps;
- observed and expected behavior;
- realistic impact;
- a suggested correction, if known.

Never include a live OAuth secret, database URL, API key, R2 credential, realtime signing key, session cookie, signed ticket, presigned URL, or another user's board data. Revoke any credential accidentally exposed during research before submitting the report.

## High-priority areas

Reports are especially valuable when they concern:

- cross-workspace or cross-board access;
- role or membership bypass;
- share-link scope or revocation failure;
- private R2 object exposure;
- OAuth account-linking or session issues;
- realtime ticket forgery, replay, or room-scope confusion;
- Durable Object isolation or revocation failure;
- stored or reflected script injection;
- server-side request forgery through AI/media inputs;
- secrets exposed to browser bundles, logs, or repository history;
- AI proposals bypassing validation or human approval.

## Supported versions

Security fixes are developed against the current `main` branch. Operators should stay on a verified recent revision and follow the production runbook's staged rollout and rollback process.

## Deployment responsibility

Self-hosters are responsible for their OAuth applications, database roles, Cloudflare account, R2 policies, provider credentials, canonical origins, backups, monitoring, and secret rotation. Start with [docs/setup.md](docs/setup.md) and review [docs/production-runbook.md](docs/production-runbook.md) before exposing Fabric publicly.

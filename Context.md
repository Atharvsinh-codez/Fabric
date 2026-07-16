# Context Log

Purpose: persistent execution log for all agent work in this repository.

Rules:
- Read this file before making any code, config, or documentation changes.
- Append new entries only. Do not edit or remove old entries.
- Log request, actions, files, diff summary, and validation results.

## Entry Template

### [YYYY-MM-DD HH:mm IST] - <short task title>
- Request: <what was asked>
- Plan: <brief plan used>
- Actions:
  - <command or action>
  - <file edit summary>
- Files Changed:
  - `<path>` - <what changed>
- Diff Summary:
  - <key before -> after behavior/config/code changes>
- Validation:
  - <tests/lint/build run + outcome>
- Risks/Notes:
  - <known caveats>
- Next Steps:
  - <if any>

### [2026-07-16 11:47 IST] - First push to GitHub main for the OpenAI Hackathon
- Request: Initialize Git for Fabric and publish the complete workspace to the empty `Atharvsinh-codez/Fabric` repository as the first `main` branch push for the OpenAI Hackathon.
- Plan: Preserve the complete reviewed project while excluding all local secrets, generated output, dependencies, caches, and runtime state.
- Actions:
  - Initialized `.git` directly on `main`.
  - Configured `https://github.com/Atharvsinh-codez/Fabric.git` as `origin`.
- Files Changed:
  - `Context.md` - Recorded the first GitHub `main` publication for the OpenAI Hackathon.
- Diff Summary:
  - Empty remote repository -> complete Fabric initial project snapshot on `main`.
- Validation:
  - Confirmed the remote repository had no existing branch heads before initialization.
  - Confirmed `.env`, `.env.local`, `.env.worker.local`, dependency folders, build output, Wrangler state, caches, and profiles are excluded by `.gitignore`.
- Risks/Notes:
  - This is the first remote history; no existing GitHub commit or branch is overwritten.
- Next Steps:
  - Push the initial commit to `origin/main`.

### [2026-07-16 11:55 IST] - first push to main github openai hackathon
- Request: Preserve the exact first-push milestone wording requested for the OpenAI Hackathon publication.
- Plan: Include this marker in the initial `main` commit.
- Actions:
  - Recorded the requested milestone phrase in `Context.md`.
- Files Changed:
  - `Context.md` - Added the exact first-push milestone marker.
- Diff Summary:
  - Initial project history now explicitly records `first push to main github openai hackathon`.
- Validation:
  - Confirmed the marker is staged with the complete initial project snapshot.
- Risks/Notes:
  - None.
- Next Steps:
  - Commit and push `main` to GitHub.

### [2026-07-16 13:46 IST] - Streaming canvas agent, native pen writing, and left AI chat
- Request: Replace Gemini with an environment-configurable OpenAI-compatible streaming model, make AI understand selected freehand content and write editable pen/diagram primitives instead of images, replace the old board AI modes/right panel with a smooth closable left chat sidebar, update local/environment documentation and the database, and push `main`.
- Plan: Audit the current tldraw selection/proposal path and the Brainstormer/Neoflow interaction ideas, preserve Fabric's approval and tenant boundaries, implement one bounded canvas-agent contract, migrate the provider without a non-streaming fallback, verify the full application, and publish only secret-free changes.
- Actions:
  - Rebuilt selection serialization so bounded draw/highlight/line geometry reaches the model and is reconstructed server-side from the authorized durable tldraw snapshot rather than trusted browser data.
  - Added deterministic one-shape native pen text, bounded native drawings, diagram shapes, labeled bound connectors, exact semantic validation, and raw persisted-drawing approval verification.
  - Replaced the mode picker and right proposal panel with one AI trigger and a responsive closable left conversation sidebar that snapshots selection and viewport at send time while retaining preview, Apply, Discard, cancellation, and durable approval.
  - Replaced the Gemini SDK/runtime with a native-fetch OpenAI-compatible Chat Completions SSE adapter, strict streaming-only configuration, environment-selected model, safe errors, bounded key rotation/failover before stream start, and explicit run provenance.
  - Added forward-only migration `0013`, removed the Gemini dependency/runtime/env examples, updated deployment documentation, and applied the migration to the configured database.
  - Reviewed Brainstormer and Neoflow for interaction and editable-diagram concepts; implemented Fabric-native contracts and tldraw primitives without copying their code.
- Files Changed:
  - `components/fabric-whiteboard.tsx`, `components/fabric-whiteboard/ai-panel.tsx`, `components/fabric-whiteboard/status-controls.tsx` - New board AI entry point and left chat workflow.
  - `lib/ai/**`, `worker/**` - Canvas-agent contracts, pen renderer, streaming provider, validation, durable processing, tests, and provider provenance.
  - `lib/boards/tldraw-ai-adapter.ts`, `lib/boards/tldraw-document.ts`, `lib/boards/canvas-document.ts`, `lib/types.ts` - Editable native shapes, selection geometry, projection, and bounds.
  - `db/schema/ai.ts`, `db/migrations/0013_foamy_lionheart.sql`, `db/migrations/meta/**` - OpenAI-compatible provider/model constraints with historical run compatibility.
  - `.env.example`, `.github/workflows/ci.yml`, `README.md`, `docs/production-runbook.md`, `package.json`, `package-lock.json` - Provider configuration, release guidance, and Gemini SDK removal.
- Diff Summary:
  - Gemini mode-specific proposal UI and buffered assumptions -> one environment-selected, streaming-only canvas agent in a closable left chat.
  - Empty summaries for selected pen strokes -> bounded authorized vector context with editable pen/diagram proposals.
  - Image-like AI output path -> image remains source-only; AI creates native tldraw pen, geo, text, frame, note, and connector records.
  - Semantic-only pen approval -> exact native draw shape, segments, renderer metadata, and fingerprint verification.
- Validation:
  - Real provider smoke test passed against the configured endpoint/model with five streamed deltas and valid schema JSON; no credential or model output was logged.
  - `npm run verify` passed: tldraw `4.2.0` and reviewed patch verified; 109 application test files / 446 tests passed; all app, realtime, Cloudflare, and AI-worker TypeScript checks passed; 15 Cloudflare runtime tests passed; ESLint and the production Next.js/server build passed.
  - `npm run db:check` passed; `npm run db:migrate` applied successfully; the production ledger reports 14 migrations and verifies the new provider/model constraints and removed defaults.
  - `npm audit --omit=dev --audit-level=high` found 0 vulnerabilities.
  - Wrangler production and development dry-runs passed; focused AI/provider/pen/sidebar tests and raw drawing tamper verification passed.
  - Pre-push scan found no production credential in tracked changes; local `.env*` files remain ignored. tldraw dependency and patch are unchanged.
- Risks/Notes:
  - The local in-app browser reached the authenticated workspace redirect but had no signed-in session; authenticated board behavior is covered by focused component/integration tests and the production build.
  - Deployment environments must continue to provide `REALTIME_COORDINATOR_SECRET` through their secret store; it is intentionally not committed.
- Next Steps:
  - Commit the reviewed scope and push `main` to `origin`.

### [2026-07-16 14:06 IST] - Restore reproducible npm 10 CI installs
- Request: Investigate and fix GitHub Actions run `29483036126`, record the completed milestone, and push it before continuing UI work.
- Plan: Reproduce the install failure with the exact CI npm version, regenerate only the lockfile, prove a genuine clean install including the reviewed tldraw patch, then publish the isolated fix.
- Actions:
  - Confirmed the Actions `verify` job stopped at `npm ci` before tests because `@emnapi/runtime@1.11.2` and `@emnapi/core@1.11.2` were missing from the lockfile.
  - Reproduced the same failure locally with npm `10.9.8`, matching the Node 22 GitHub runner.
  - Regenerated `package-lock.json` with npm `10.9.8`, restoring the required optional/peer dependency records without changing declared dependencies.
- Files Changed:
  - `package-lock.json` - Synchronized the cross-platform dependency graph with the npm version used by CI.
  - `Context.md` - Recorded the CI diagnosis, focused correction, and verification.
- Diff Summary:
  - npm 11-generated lockfile rejected by npm 10 CI -> npm 10-compatible lockfile with complete `@emnapi` records.
- Validation:
  - A genuine `npx npm@10.9.8 ci` completed and the `patch-package` postinstall reapplied `@tldraw/editor@4.2.0` successfully.
  - `npx npm@10.9.8 ci --dry-run --ignore-scripts` passed.
  - `npm run verify:tldraw` and `npm run typecheck` passed.
  - `npm audit --omit=dev --audit-level=high` found 0 production vulnerabilities.
- Risks/Notes:
  - The repository has no pre-commit configuration; its npm verification and GitHub Actions workflow remain the enforced gates.
- Next Steps:
  - Commit and push this isolated CI fix, then continue the approved Fabric agent sidebar/loading milestone.

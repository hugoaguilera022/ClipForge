# ClipForge Studio — consolidation audit

Status: audit branch only. No production resources or source repositories have been deleted or renamed.

## Confirmed GitHub repositories

- `hugoaguilera022/ClipForge` — default branch `main`; current primary editor candidate.
- `hugoaguilera022/autotube` — default branch `main`; separate Node.js application with YouTube automation, generation and publishing workflows.
- `hugoaguilera022/relaxscape-studio` — explicitly out of scope; keep independent.

## Initial architecture findings

### ClipForge
- Python server and static HTML/CSS/JavaScript PWA.
- FFmpeg/FFprobe media processing.
- Whisper-based transcription; local MLX/Faster-Whisper/whisper.cpp options.
- Optional local Ollama semantic ranking and optional vision components.
- Existing `render.yaml` defines:
  - Static site `clipforge-final`.
  - Docker web service `clipforge-api-hugo`.
  - Frontend API rewrite to the backend.
- Existing Render Blueprint points to branch `codex/clipforge-editor-stabilization`, not necessarily current `main`.

### AutoTube
- Separate Node.js 22 / Express application.
- YouTube OAuth/import/publishing and AI-assisted content production.
- Uses Supabase JS client and Google APIs among its dependencies.
- Existing `render.yaml` defines a Node web service `autotube`.
- Provider keys and paid-provider flags are declared as environment configuration; do not enable paid providers under the current 0 EUR/month constraint.

## Proposed target

A single product/repository named **ClipForge Studio**, with modular capabilities:
1. ClipForge editor as the primary product and user experience.
2. AutoTube capabilities integrated selectively as modules (YouTube import/OAuth, script/metadata workflows, publishing/automation), not by blindly merging both servers.
3. One canonical project/auth/data model and explicit API boundaries.
4. Separate deployable services only where required by runtime constraints.

## Required before migration
- Inventory every route, feature, database table, storage bucket, environment variable, scheduled job and external callback in both apps.
- Compare existing Supabase projects and schemas; do not overwrite either.
- Verify Render service IDs, domains, deploy branches, build/start commands, disks, env var names and health checks.
- Build an integration map and automated regression tests.
- Back up repositories and data; migrate on a new branch; deploy a preview; verify end-to-end before cutover.

## Deletion policy
Do not delete, archive, rename, or repoint existing repositories or Render services until:
- the unified build passes tests,
- a preview deployment passes end-to-end checks,
- data and secrets are accounted for,
- production cutover is verified,
- rollback instructions are tested.

## Verified follow-up findings (2026-11-16)

- The Render workspace **ClipForge** is accessible and selected for the read-only audit. Workspace ID: `tea-dasrcurbc2fs73a12d90`.
- The six relevant Render services and their current branch/auto-deploy settings are recorded in `docs/CLIPFORGE_STUDIO_CODEX_HANDOFF.md`.
- ClipForge API and frontend services currently deploy from `codex/clipforge-editor-stabilization`; the importer pair and preview use `integrated-web-final`; AutoTube deploys from `main`.
- PR #71 currently changes documentation only. It has three commits and is still a draft.
- PR #71 quality run `43867292221` failed: 233 tests passed and two tests failed in `tests/test_editorial_candidate_context.py`. Details and required remediation are in the Codex handoff.
- ClipForge project and job persistence are file/SQLite-backed. Render's service detail response showed no attached persistent disk; durability on redeploy must be resolved before multi-user production cutover.
- AutoTube's YouTube connection is currently process-global and stored as one encrypted Supabase `youtube_connections` row with ID `default`. This must not become the ClipForge multi-user auth design.
- The two YouTube importer services share the same repository, branch and Dockerfile, but remain unproven duplicates; no service has been changed.

See `docs/CLIPFORGE_STUDIO_CODEX_HANDOFF.md` for route families, service IDs, test failures, integration sequence and non-negotiable safeguards.

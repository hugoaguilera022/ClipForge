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

## Current blockers
- Render workspace selection needs user confirmation: the screenshot shows an **Autotube** workspace, while the connected Render workspace listing currently returns **hugo's workspace**. Confirm whether these are the same intended workspace before any Render mutation.
- The available GitHub integration does not expose repository creation/rename in the current tool set. This audit branch is a safe staging point; create/rename operations should be performed only when an authorized supported action is available.

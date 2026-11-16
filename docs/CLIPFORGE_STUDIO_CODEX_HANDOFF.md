# ClipForge Studio — Codex execution handoff

Updated: 2026-11-16
Repository: `hugoaguilera022/ClipForge`
Working branch: `codex/clipforge-studio-consolidation-audit`
Pull request: [#71](https://github.com/hugoaguilera022/ClipForge/pull/71)
Scope: integrate useful AutoTube workflows into ClipForge without replacing the editor or interrupting either production app.

## Mandatory operating rules

- Read `AGENTS.md`, `docs/CLIPFORGE_STUDIO_MASTER_SPEC.md`, `docs/CLIPFORGE_STUDIO_CONSOLIDATION_PLAN.md`, and this file before coding.
- Work only on the audit/feature branch or a new child feature branch. Never commit to `main`, `codex/clipforge-editor-stabilization`, or `integrated-web-final`.
- Keep `hugoaguilera022/autotube`, its Render service, and its Supabase project operational and unchanged while building the integration.
- Keep `hugoaguilera022/relaxscape-studio` completely out of scope.
- No production Render changes, deploy triggers, branch changes, env-var edits, OAuth callback edits, database migrations, or service deletion as part of the initial implementation.
- No new paid provider, billing activation, or recurring cost. Preserve all AutoTube free-tier caps and paid-provider kill switches. Target additional recurring spend: €0/month.
- Never fetch, print, commit, or expose secret values. Work from variable names and mocked fixtures only.
- Preserve all existing ClipForge editor, transcription, project, timeline, subtitle, audio-mix and MP4-export behavior. Avoid wholesale rewrites.
- Any YouTube download/import path must enforce user rights/authorization; public metadata analysis is not permission to download or republish protected video.

## Confirmed source architecture

### ClipForge (primary product)

- Static PWA: `static/index.html`, `static/app.js`, `static/editor.js`, `static/capcut-editor.js`, `static/capcut-editor-enhancements.js`, `static/browser-export.js`, `static/styles.css` and related assets.
- Python standard-library HTTP server: `server.py`.
- Media engine: `clipforge.py`, FFmpeg/FFprobe, Whisper adapters (MLX/Faster-Whisper/whisper.cpp).
- Worker and queue: `worker.py`, `job_store.py`, SQLite `data/jobs.sqlite3`.
- Projects: `project_store.py`, versioned JSON schema `clipforge-project-v2`, currently file-backed under `projects/`.
- Tests include Python unit/regression tests and Chromium browser tests under `tests/`.
- Existing CI: `.github/workflows/quality.yml` (Python 3.12, FFmpeg, Chromium, pytest, JS syntax and media fixture).

Observed ClipForge API path families in `server.py`: `/api/health`, `/api/jobs`, `/api/download`, `/api/preview`, `/api/editor/export`, `/api/projects`, `/api/channels`, `/api/platforms`, `/api/inbox`, `/api/inbox/scan`, `/api/review`, and `/api/re-render`. Inspect handler code for exact methods, payloads, auth and status semantics before wiring anything.

### AutoTube (source of reusable modules)

- Node 22 / Express: `server.js`; static UI in `public/`.
- YouTube OAuth and API route preload: `youtube-routes-preload.js`.
- AI provider catalogue/adapters: `universal-ai-providers.js`.
- Existing helpers/preloads: URL-to-MP4, YouTube routes, render stability, image generation and provider bridges. Do not blindly copy preloads; identify their actual effect and load order first.
- Supabase migration: `supabase/migrations/20260930_youtube_automation.sql`.
- Existing data tables in that migration: `autotube_channels`, `autotube_stories`, `autotube_jobs`, `autotube_publications`, `autotube_analytics_snapshots`; the OAuth integration also uses `youtube_connections` (verify its actual schema and RLS from the live migration history before any migration).
- Main server route families include health, preflight, AI capabilities, production-plan/story-clip, render jobs, URL-to-video jobs, full-pipeline test jobs, provider/capacity status, reference analysis, and media downloads.
- YouTube route preload adds `GET /api/youtube/auth`, `GET /api/youtube/callback`, `GET /api/youtube/profile`, `GET /api/youtube/analytics`, `GET /api/youtube/automation-config`, `POST /api/youtube/upload`, and `POST /api/youtube/disconnect`.
- OAuth currently keeps a process-level `youtubeTokens` value and persists encrypted tokens to Supabase row `youtube_connections.id='default'`. This is a single-connection design, not a multi-user account model. Do not reuse it for ClipForge users without designing per-user ownership, CSRF/state validation, encryption-key handling, token refresh/revocation and RLS.
- AutoTube has numerous GitHub automation workflows, including autonomous repair/watchdog and long-running E2E flows. Do not enable/copy these into ClipForge wholesale; identify only required CI workflows and keep test workflows mocked/free by default.

## Render facts verified in workspace "ClipForge"

| Service | ID | Repo / branch | Runtime | Auto deploy |
|---|---|---|---|---|
| clipforge-api-hugo | `srv-dbs3p96i0phs73c1prc0` | ClipForge / `codex/clipforge-editor-stabilization` | Docker, `Dockerfile.clipforge-api`, free Frankfurt | Off |
| clipforge-final | `srv-dbooid2jnfac73fihk10` | ClipForge / `codex/clipforge-editor-stabilization` | Static, `static/`, free | Off |
| clipforge-youtube-importer | `srv-dbooi7mc6qcc7388eelg` | ClipForge / `integrated-web-final` | Docker, `Dockerfile.youtube-proxy`, free | Off |
| clipforge-youtube-ingest | `srv-dboogv2jnfac73fidhhg` | ClipForge / `integrated-web-final` | Docker, `Dockerfile.youtube-proxy`, free | On |
| clipforge-preview | `srv-dbo7737f3r2c73ac903g` | ClipForge / `integrated-web-final` | Static, free | On |
| autotube | `srv-dasrdmvpn0mc739n1at0` | AutoTube / `main` | Node, free Frankfurt | On |

- The frontend static site rewrites `/api/*` to `https://clipforge-api-hugo.onrender.com/api/*`.
- API health check is `/api/health`.
- The two YouTube importer services share repository, branch, Dockerfile and free plan, but duplication is NOT proven. Compare env var names (never values), logs, request volume, callers and latest deployed SHAs before recommending consolidation.
- Service descriptions returned no attached persistent disk. ClipForge uses local SQLite and `projects/` files. Verify persistence/backup requirements before relying on these paths for durable user data on Render; do not add paid storage or change plans without approval.
- Render workspace ID used for this audit: `tea-dasrcurbc2fs73a12d90`.

## Current CI blocker on PR #71

GitHub Actions run `43867292221` ("ClipForge quality checks") failed at the automated pytest step: **233 passed, 2 failed**. Compilation, Ruff critical-error checks and JavaScript syntax checks passed. Chromium E2E and media fixture steps were skipped after pytest failed.

Failing tests:
1. `tests/test_editorial_candidate_context.py::test_editorial_bundle_cache_bust_changes_with_candidate_context_logic` — expects `/browser-whisper-inline-v3.js?v=20261115-editorial-context1` in `static/index.html`, but the current HTML contains a different/missing version string.
2. `tests/test_editorial_candidate_context.py::test_word_level_whisper_timestamps_still_produce_four_editorial_windows` — the Node subprocess invoked by the test exits non-zero. Re-run this test alone and capture stderr to identify whether the embedded JS harness or candidate-window logic is at fault.

The two failures were inspected and corrected on the working branch (commit `dcee381f676d9152c14e3a40486c5b8aff460084`): the HTML now uses the expected cache-busting version for the updated module, and the test's Node harness now inserts a real newline instead of a literal backslash-n outside the JavaScript function. A new quality run (`43868002047`) was queued for this commit at 12:35 UTC and must complete green before integration proceeds. Do not hide, skip, weaken or delete the tests.

## Integration sequence for Codex

### 1. Establish a clean baseline
- Record exact deployed SHAs and current service health for all six Render services.
- Inspect the latest relevant ClipForge editor PRs and the exact branch contents; do not assume `main` is the deployment source.
- Re-run and fix the two CI failures above before feature integration.
- Run the full existing test suite and preserve browser export/editor tests as mandatory regression gates.

### 2. Build a module/contract map
- Inventory exact AutoTube route methods, request/response schemas, provider usage, OAuth scopes/callback URLs, job lifecycle, scheduled workflows and Supabase RLS.
- Inventory ClipForge project/timeline schema, source media handling, auth boundaries and job APIs.
- Classify each AutoTube capability as: reusable server-side module, adapter requiring a new contract, not safe to reuse, or excluded (paid/unsafe/duplicate).
- Prefer script/metadata generation and YouTube channel management as separately testable modules. Do not merge the two HTTP servers or frontends blindly.

### 3. Add a safe integration boundary
- Introduce versioned ClipForge API adapters and feature flags defaulting OFF.
- Start with mocked providers and contract tests. Keep OAuth secrets server-side.
- For OAuth, use explicit per-user ownership and secure state/CSRF validation; do not use AutoTube's global default token as ClipForge's shared login.
- Use ClipForge's canonical project and edit-decision model. A generated clip/script must become an editable project item, not a parallel timeline representation.
- Do not add a second render engine; FFmpeg remains the media processing foundation.

### 4. Unify the UX without regressions
- Keep the existing editor layout and interactions.
- Add a YouTube workspace/library entry point and AI script/metadata panel only after API contracts are tested.
- Implement import → transcript/selection → timeline edit → captions/audio → save/reopen → MP4 export.
- Verify preview and export produce the same edit decisions and timing.

### 5. Validate preview and hand off
- Use an isolated preview service/branch only after reviewing its exact Render plan and cost (must remain free).
- Do not point production services at the audit branch. Current Render auto-deploy settings are mixed; a push to `integrated-web-final` can trigger deployment of some services.
- Test mocked OAuth, authorized test-channel OAuth, metadata generation, upload dry-run, project persistence, browser E2E and export.
- Document rollback, environment variable NAMES (not values), data migration and any external callback changes.
- Leave PR #71 as draft until tests and the preview are green. Never merge or cut over automatically.

## Definition of done

- Existing ClipForge workflows and browser tests pass.
- AutoTube features are accessible within ClipForge projects through tested contracts.
- One user identity/account model is defined; no shared global YouTube token.
- Projects survive restart/redeploy according to a documented storage strategy.
- Preview equals exported MP4 for video, audio, subtitles and overlays.
- No paid providers activated, no secret leaks, no unapproved schema/OAuth/Render changes.
- AutoTube remains independently recoverable and production cutover is reversible.

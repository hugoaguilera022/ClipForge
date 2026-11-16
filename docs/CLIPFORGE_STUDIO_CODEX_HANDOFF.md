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


## API, editor and end-to-end audit (2026-11-16)

### Confirmed source and deployed architecture

- ClipForge frontend is a Render Static Site (`clipforge-final`) publishing the repository `static/` directory. Its Render build command is currently only `echo "ClipForge static frontend ready"`; auto-deploy is off.
- ClipForge API is a separate Docker web service (`clipforge-api-hugo`) running `python server.py`, with FFmpeg installed in its image, on the same Render environment. Auto-deploy is off.
- The static frontend calls relative `/api/...` URLs (including `/api/editor/export`, `/api/projects`, `/api/jobs`, `/api/health`). The API is on a different hostname. The Static Site service details do not show a reverse-proxy route to the API. Do not assume the browser app can reach the backend correctly until browser network tests verify this.
- The Python server serves `/` and only a small hard-coded set of static files (`app.js`, `browser-whisper.js`, `editor.js`, `styles.css`, manifest, service worker). It does not currently serve all the reference editor assets referenced by `static/index.html` (CapCut editor, editor reference UI, timeline core, browser export, auth, Google Drive, styles). Therefore simply switching the frontend to the API hostname is not sufficient; either safely serve the full static asset tree from the API host or implement an authenticated CORS API client and a verified routing strategy.
- The current browser auth module uses Supabase Auth with Google OAuth and a publishable key. This is expected to be public. The Python API source has no Authorization/Bearer/JWT validation or Supabase session enforcement. All upload, job, project, preview and export endpoints must be protected before public multi-user use.
- ClipForge projects and job state use local files/SQLite under the service filesystem (`projects/`, `data/jobs.sqlite3`, uploads, outputs, editor exports). The Render API service has no attached persistent disk in its service detail. This data is at risk on redeploy/replacement; do not declare production-ready persistence until moved to Supabase Postgres/Storage with RLS, or an explicitly approved persistent disk plan.
- Latest ClipForge quality workflow `43869360539` on PR #71 head `5be64f07a1346c93fe01b20cc1c49ed250cfb82f` completed successfully. Its aggregate job `Python, JavaScript and media smoke tests` passed. This validates the CI suite only, not live OAuth, real YouTube downloads, real Whisper inference on Render, full browser-to-API calls, or a real multi-track MP4 export.

### Existing editor and media capabilities

- UI modules are already present: `static/capcut-editor.js`, `static/capcut-editor-enhancements.js`, `static/timeline-core.js`, `static/editor-reference-ui-v2.js`, and `static/editor-reference-ui-v2.css`.
- Existing browser tests cover editor mounting, timeline tracks, adding text, copy/paste, locked tracks and undo. The export path records the browser timeline, posts a media file to `/api/editor/export`, then polls an FFmpeg conversion job. A real media E2E test must verify actual pixels/audio/subtitles, not only editor DOM state.
- Backend production pipeline already uses `yt-dlp`, `ffprobe`/FFmpeg and `faster-whisper` (CPU INT8) as local/self-hosted components. The browser transcription module also supports Whisper in-browser. These should be the default transcription paths; no paid transcription API is required to get the core workflow running.
- Browser export imports MediaBunny, JSZip and MediaPipe Face/Pose Landmarker models from pinned CDN/model URLs. These are dependencies, not paid APIs; add graceful offline/error handling and pin/verify integrity where feasible.

### API/provider decision matrix

| Capability | Preferred integration | Required? | Decision |
|---|---|---:|---|
| YouTube metadata/source | yt-dlp metadata and authorized source file import; YouTube Data API v3 only for official metadata/channel features | For URL import | Keep yt-dlp server-side; use YouTube API key only for quota-backed metadata, never as a downloader or restriction bypass |
| YouTube account connect/publish | Google OAuth 2.0 + YouTube Data API v3 upload scopes | Only if publishing is enabled | Add later, user-consented OAuth per channel; do not reuse AutoTube's process-global `youtube_connections.id=default` token |
| Transcription | faster-whisper on backend CPU or browser Whisper/WebGPU | Yes, one path must be healthy | Keep local/self-hosted first; expose engine/model status and retry/fallback |
| Editorial candidate selection | Existing transcript/timing heuristics first; optional Gemini or OpenRouter/Groq server-side provider adapter for semantic ranking | No, enhancement | Do not put provider secrets in frontend/localStorage; keys server-side, rate-limited, opt-in and cost-capped |
| Video editing/render | FFmpeg + ffprobe and existing browser timeline exporter | Yes | No external render API; one canonical edit-decision model must drive preview and MP4 |
| Face-aware crop | MediaPipe Face Landmarker (browser) with center-crop fallback | Optional | Keep local inference; verify orientation, face-loss and no-face fallback |
| Auth | Existing Supabase Auth Google OAuth | Yes for multi-user | Keep publishable key in browser; validate Supabase JWT on every protected backend route |
| Projects/jobs/media persistence | Supabase Postgres + Storage with per-user RLS and signed URLs | Yes for production | Migrate SQLite/files before relying on Render ephemeral filesystem |
| Cloud file export | Google Drive OAuth integration already present | Optional | Keep as explicit user action; not needed for core export |
| Stock assets | Pexels/Pixabay | Optional | Not required for clipping an imported source; server-side keys only |
| AI-generated video/audio/images | AutoTube providers (FAL, Replicate, Hugging Face, Pollinations, etc.) | No for clipping | Do not import into the core clip pipeline. Render logs show HTTP 402 paid Pollinations models, HF credit/unsupported-task errors and shared ZeroGPU quota cooldowns. Keep behind opt-in feature flags and hard spend kill-switches if ever used |

### Required implementation order (do not skip)

1. **Make one origin work:** choose a canonical app/API origin. Safest initial option is to serve the complete static editor asset tree from the authenticated API service, or implement a central API client with explicit API base URL, CORS allowlist and JWT forwarding. Add Playwright tests that assert every API call resolves on the deployed preview. Do not rely on unverified Render Static Site rewrite-to-external-service behavior.
2. **Secure the backend:** validate Supabase JWT and derive user ID on all project/job/upload/preview/export routes; enforce ownership checks and request/file size limits. Do not trust a frontend-only login.
3. **Persist data:** migrate project JSON, job state, media objects and export outputs to Supabase Postgres/Storage (or obtain explicit approval for a persistent disk). Add RLS, signed download URLs, cleanup and retention policy. Keep local SQLite as a development/test adapter only.
4. **Stabilize import and transcription:** test local MP4 upload and authorized YouTube URL, metadata, yt-dlp download, ffprobe validation, audio extraction, Whisper transcription with word timestamps, diarization fallback, cancellation, retry and job recovery. Do not claim URL import works from CI-only tests.
5. **Unify editorial selection:** one canonical candidate schema should include source start/end, score, rationale, transcript segments, speaker/context, title and confidence. Prevent truncating sentences, splitting context, overlapping clips and out-of-range subtitle timings. Keep original source untouched.
6. **Make the editor truly functional:** ensure clip selection opens the matching source range; trim/split/ripple, reorder, duplicate, delete, undo/redo, multi-track video/audio/text, per-clip mute/volume, fade, subtitle edit/style/highlight, aspect ratio, face crop, effects and project save all update the same timeline model. Avoid decorative controls without working callbacks.
7. **Prove preview/export parity:** render a deterministic fixture with at least two video clips, multiple subtitle segments, a second audio track, a mute region, fades, crop and effect. Compare exported MP4 duration, frame samples, audio RMS/silence and subtitle burn-in to the timeline preview. Run ffprobe on final output and test download/resume after reload.
8. **Production gate:** no production cutover until auth, storage, API routing, import, transcription, editing and real MP4 export E2E pass on an isolated preview. Keep rollback and source services intact.

### Current live signals and limitations

- Render logs for the ClipForge API and static frontend showed no error/warning entries in the queried window; API logs include repeated `GET /api/health 200`. This is not proof that the editor's cross-origin API calls work.
- AutoTube service logs show repeated video-generation capacity exhaustion, paid Pollinations HTTP 402 responses, Hugging Face credit/unsupported-task errors and ZeroGPU cooldowns. These features are not prerequisites for ClipForge's clip extraction/editing/export workflow.
- No API keys, OAuth credentials, provider billing, production schemas or production environment variables were added or changed during this audit.

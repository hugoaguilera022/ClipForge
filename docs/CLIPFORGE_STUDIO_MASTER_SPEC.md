# ClipForge Studio — master product and integration specification

## Mission
Create one coherent product by combining the useful capabilities of the existing ClipForge and AutoTube projects. ClipForge remains the primary editor and canonical user experience. AutoTube contributes reusable YouTube workflow capabilities. Keep `relaxscape-studio` entirely independent.

## Source systems audited
### ClipForge (`hugoaguilera022/ClipForge`)
- PWA frontend: HTML/CSS/JavaScript.
- Python standard-library server.
- FFmpeg/FFprobe media pipeline.
- Whisper transcription: MLX Whisper on Apple Silicon; Faster-Whisper/whisper.cpp fallbacks.
- Optional Ollama semantic ranking and optional OpenCV/Haar framing.
- Render deployment currently uses `Dockerfile.clipforge-api` and `static/`.
- Existing Render Blueprint routes frontend `/api/*` to `clipforge-api-hugo`.

### AutoTube (`hugoaguilera022/autotube`)
- Node.js 22 / Express application.
- YouTube OAuth and Google APIs.
- Supabase JS client.
- AI-assisted script/metadata generation and production workflows.
- Optional media providers (Pexels, Pixabay, ElevenLabs, Fal, Replicate, Hugging Face).
- Existing configuration explicitly disables paid providers by default; preserve this.
- Separate session/auth and API concerns must be reviewed before integration.

## Product modules
1. **Studio editor (core):** media bin, vertical preview, multi-track timeline, inspector, subtitles, audio, effects, keyframes, undo/redo, project save/restore.
2. **Media intelligence:** transcription, timestamped segments, candidate clip scoring, optional semantic reranking, face-aware reframing.
3. **YouTube workspace:** authorized URL/import workflows, metadata, OAuth connection, upload/publish and scheduling where supported by YouTube API policies.
4. **AI production assistant:** optional scripts, titles, descriptions, metadata and production planning.
5. **Project/account layer:** one canonical project model and ownership/auth model. Do not assume the two existing auth systems or Supabase schemas are compatible; inspect and migrate deliberately.
6. **Operations:** health checks, structured logs, background jobs only where needed, quotas, retries and user-visible job states.

## Integration architecture
- Keep the current ClipForge frontend as the primary app unless a tested redesign replaces it.
- Prefer one public web origin and one canonical API boundary.
- Reuse AutoTube capabilities as isolated modules/services initially; avoid copying its whole Express server into Python or running two competing session systems.
- Define versioned internal API contracts for YouTube OAuth/import/publish and AI production.
- Use a queue/background worker only for long-running jobs if the current Render free-tier constraints permit it; never assume always-on free worker availability.
- FFmpeg is the media processing foundation. Browser preview and export must consume the same canonical edit-decision/project representation.
- Keep provider keys server-side. Never put secrets in frontend code, commits, logs or client-visible config.
- Keep provider spend disabled by default. No paid API or service may be activated without explicit user approval. Target additional recurring spend: €0/month.

## Data and security
- Inventory both projects' Supabase URLs, project IDs, tables, RLS policies, buckets, OAuth callback URLs and secret names before selecting a canonical data store.
- Do not overwrite or delete existing data. Back up first; produce a reversible migration.
- Use least-privilege OAuth scopes. Do not request YouTube upload permissions until the user enables publishing.
- Do not store third-party OAuth refresh tokens in browser storage.
- Respect source-media rights and platform terms; metadata access does not grant permission to download arbitrary videos.
- Preserve AutoTube's paid-provider kill switches and free limits.

## Required integration stages
### Stage A — complete inventory
- Enumerate every route, module, feature, script, database table, bucket, env var, OAuth callback, cron/scheduled task and Render service in both repos.
- Identify duplicate YouTube importer/ingest deployments by comparing actual code, branches, env vars, traffic and logs.
- Compare active branches and deployed commit SHAs. Do not assume `main` is what production serves.

### Stage B — modular integration
- Add AutoTube functionality behind feature flags and stable API interfaces.
- Bring in only verified reusable code; preserve attribution and licenses.
- Add tests for YouTube OAuth callback, import, metadata, script generation and publishing (mock external APIs).
- Preserve the existing ClipForge editing pipeline and add regression tests before refactoring.

### Stage C — unified UX
- Expose YouTube workflows from ClipForge's project/library flow.
- Reproduce the user's editor references: left media/library, central vertical monitor, right contextual inspector, lower multi-track timeline.
- All editor actions must update one canonical project state; preview and export must match.
- No decorative controls: every visible control must have a working action and test.

### Stage D — deploy and cut over
- Deploy a preview from the consolidation branch.
- Run unit, integration, accessibility and browser E2E tests.
- Verify import -> edit -> subtitles -> audio -> save/reopen -> MP4 export.
- Verify YouTube OAuth in a test channel before production publishing.
- Switch traffic only after acceptance; retain rollback to existing services.

## Render observations at audit time
Workspace: `ClipForge`.
- `clipforge-api-hugo`: Docker, repo ClipForge, branch `codex/clipforge-editor-stabilization`, health `/api/health`.
- `clipforge-final`: Static Site, repo ClipForge, same branch; rewrite `/api/*` to API.
- `clipforge-youtube-importer`: Docker, repo ClipForge, branch `integrated-web-final`, Dockerfile `Dockerfile.youtube-proxy`.
- `clipforge-youtube-ingest`: Docker, repo ClipForge, branch `integrated-web-final`, same Dockerfile path. Possible duplicate, not proven.
- `clipforge-preview`: Static Site, repo ClipForge, branch `integrated-web-final`.
- `autotube`: Node service, repo AutoTube, branch `main`.

All services had auto-deploy disabled except `clipforge-youtube-ingest`, `clipforge-preview`, and `autotube`. Verify current settings before changes.

## Non-negotiable safeguards
- Do not delete, archive, rename, suspend, repoint or overwrite any repository, Render service, database, bucket or OAuth app until the unified preview has passed E2E and rollback is documented.
- Do not change production branch settings as part of initial integration.
- Do not add paid providers or enable billing.
- Keep `relaxscape-studio` untouched.
- Report what is actually implemented versus merely planned.

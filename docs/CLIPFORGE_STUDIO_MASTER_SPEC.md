# ClipForge Studio — master integration specification

ClipForge remains the primary editor and canonical product. AutoTube contributes selectively reusable YouTube and AI-production workflows. Keep `relaxscape-studio` independent and untouched.

## Audited source architecture
- ClipForge: HTML/CSS/JavaScript PWA, Python standard-library server, FFmpeg/FFprobe, Whisper (MLX/Faster-Whisper/whisper.cpp), optional Ollama semantic ranking and OpenCV/Haar framing. Render uses `Dockerfile.clipforge-api` and `static/`; frontend rewrites `/api/*` to the Python API.
- AutoTube: Node.js 22/Express, YouTube OAuth/Google APIs, Supabase JS client, AI script/metadata workflows, optional media providers (Pexels, Pixabay, ElevenLabs, Fal, Replicate, Hugging Face). Its Render config defaults paid providers off. Preserve all paid-provider kill switches and free limits.

## Unified product modules
1. Studio editor: media bin, vertical preview, multi-track timeline, contextual inspector, subtitles, audio, effects, keyframes, undo/redo, save/restore.
2. Media intelligence: transcription, timestamped segments, clip candidate scoring, optional semantic reranking, face-aware reframing.
3. YouTube workspace: authorized import, metadata, OAuth connection, upload/publish and scheduling where permitted.
4. AI production assistant: optional scripts, titles, descriptions and metadata.
5. Canonical project/account model with explicit data ownership and auth boundaries.
6. Operations: health checks, job states, retries, quotas and structured logs.

## Integration design
- Keep the existing ClipForge frontend and editing pipeline as the core unless a tested replacement proves better.
- Prefer one public origin and one canonical API boundary.
- Initially integrate AutoTube features as isolated modules behind feature flags and versioned API contracts. Do not blindly merge the Express server into Python or run two competing session systems.
- FFmpeg remains the media processing foundation. Timeline, preview and export must share one canonical edit-decision representation.
- Keep API keys server-side. No secrets in frontend bundles, commits or logs.
- Additional recurring spend target: €0/month. No paid provider or billing activation without explicit approval.

## Data and security
Inventory both Supabase projects, tables, RLS policies, buckets, OAuth callbacks and environment variables before choosing canonical storage. Back up first; migrations must be reversible. Use least-privilege OAuth scopes. Do not store refresh tokens in browser storage. Metadata access does not grant permission to download arbitrary video.

## Required stages
### A — inventory
Enumerate routes, modules, features, scripts, tables, buckets, env vars, OAuth callbacks, scheduled tasks and deployed commit SHAs. Compare active branches. Determine whether the two YouTube importer services are truly duplicates using code, env, traffic and logs.

### B — modular integration
Add AutoTube features behind flags and stable contracts. Preserve attribution/licenses. Add mocked tests for OAuth, import, metadata, script generation and publishing. Add regression tests for ClipForge before refactoring.

### C — unified UX
Expose YouTube workflows from ClipForge projects/library. Match the reference editor layout: media/library left, vertical monitor center, contextual inspector right, multi-track timeline below. Every control must work and be tested. Preview and export must match.

### D — deployment
Deploy a preview branch; run unit, integration, accessibility and browser E2E tests. Verify import → edit → subtitles → audio → save/reopen → MP4 export. Test YouTube OAuth in a test channel. Cut over only after acceptance; retain rollback.

## Render inventory observed in workspace ClipForge
- `clipforge-api-hugo`: Docker, ClipForge repo, branch `codex/clipforge-editor-stabilization`, health `/api/health`.
- `clipforge-final`: Static Site, ClipForge repo, same branch; `/api/*` rewrite to API.
- `clipforge-youtube-importer`: Docker, ClipForge repo, branch `integrated-web-final`, Dockerfile `Dockerfile.youtube-proxy`.
- `clipforge-youtube-ingest`: Docker, same repo/branch/Dockerfile. Possible duplicate, not proven.
- `clipforge-preview`: Static Site, ClipForge repo, branch `integrated-web-final`.
- `autotube`: Node service, AutoTube repo, branch `main`.

Auto-deploy was disabled on API, web and importer; enabled on ingest, preview and AutoTube at audit time. Re-check before action.

## Safeguards
Do not delete, archive, rename, suspend, repoint or overwrite any repo, Render service, database, bucket or OAuth app until preview E2E passes and rollback is documented. Do not change production branches during initial integration. Keep relaxscape-studio untouched. Distinguish implemented work from plans.

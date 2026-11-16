# ClipForge Studio — API, AI and tooling recommendations

Research date: 2026-11-16
Repository: hugoaguilera022/ClipForge
Branch: codex/clipforge-studio-consolidation-audit
Basis: source audit in CLIPFORGE_STUDIO_CODEX_HANDOFF.md and current official provider documentation.
Decision target: reliable end-to-end clipping/editor/export, with additional recurring spend kept at €0 unless explicitly approved.

## Executive decision

Do not connect a large catalogue of providers. ClipForge already has the right core stack: browser editor/timeline, Python API, FFmpeg/ffprobe, yt-dlp metadata/import helpers, Faster-Whisper and browser Whisper, MediaPipe, Supabase Auth, and a project/job model. The bottlenecks are integration, security, durable media storage, and export parity—not lack of APIs.

Build a provider-adapter layer with one default path and optional fallbacks. Keep external AI off the critical path so editing and export still work when a provider is unavailable.

## Recommended stack by capability

| Capability | Recommendation | Role | Cost posture | Decision |
|---|---|---|---|---|
| Timeline/editor | Existing ClipForge CapCut editor + timeline-core + one canonical edit-decision schema | All edits, preview, undo/redo, save/reopen | No per-edit API fee | KEEP / COMPLETE |
| Media processing | FFmpeg + ffprobe server-side; browser MediaBunny only where useful | Decode, trim, crop, mix, subtitles, encode MP4 | Open source; compute/storage still cost | KEEP; no SaaS render API |
| Primary transcription | Existing Faster-Whisper / browser Whisper | Spanish and multilingual transcript with timestamps | No per-minute API bill; consumes client/server compute | KEEP; benchmark real Spanish interview/podcast clips |
| Optional transcription fallback | Groq Whisper Large v3 Turbo or Large v3 | Fast hosted transcription if local inference fails or is too slow | Published docs list about $0.04/hour turbo and $0.111/hour large; subject to provider limits | OPTIONAL, feature flag, explicit API key |
| Accuracy fallback | OpenAI gpt-transcribe | Second opinion / hard audio / language detection | Official price currently $0.0045/minute | OPTIONAL paid fallback; do not use deprecated whisper-1 or gpt-4o-transcribe for a new integration |
| AI clip ranking | Gemini Flash text model via server-side adapter, using transcript windows + speaker/context + local scene/audio features | Rank candidate moments and explain why they work | Free-tier testing exists; production terms/privacy differ; paid use is metered | RECOMMENDED OPTIONAL enhancement |
| Video scene understanding | Gemini video understanding only for selected candidate ranges/keyframes, not every full source by default | Describe visual context, scene changes, salient timestamps | Metered by video/audio/image tokens; static video mode samples 1 FPS and can miss fast action | OPTIONAL; use sparingly after transcript shortlist |
| Face-aware reframing | Existing MediaPipe Face Landmarker in browser; optional local tracking/smoothing | Keep speaker in 9:16 crop | Local inference; no hosted inference fee | KEEP / IMPROVE |
| Project/auth data | Existing Supabase Auth + Postgres with strict RLS | User identity, project metadata, jobs, edit decisions, OAuth ownership | Free currently includes 500 MB DB, 1 GB Storage, 5 GB egress; projects pause after inactivity | RECOMMENDED canonical metadata/auth store |
| Large media objects | Supabase Storage initially for small tests; design a Storage adapter for a larger object store later | Originals, proxies, exports | Free Storage 1 GB and max upload 50 MB on current pricing page; not enough for a serious video product | BLOCKER to production scale |
| YouTube metadata/channel features | YouTube Data API v3 | Public metadata, channel info, user-authorized uploads/analytics | Quota-based; default project quota includes 10,000 units/day for most endpoints; search and uploads have separate quotas | ADD only needed endpoints |
| YouTube login/publishing | Google OAuth 2.0, per-user/per-channel tokens | Connect channel, upload/publish, analytics | OAuth itself has no per-call fee; quota/policy limits apply | ADD after backend auth and ownership model |
| Observability | Structured JSON logs + request/job IDs + health/metrics; Sentry-compatible reporting only if privacy/cost acceptable | Diagnose failed imports, transcription, render jobs | Start with Render logs and free/local tooling | ADD structured logs first |
| Background processing | Existing worker/job_store; define queue contract and idempotent jobs | Long imports, transcription, export, retries/cancel | Existing free service limits constrain throughput | KEEP; improve retries/timeouts/cancellation |

## Why these choices

### 1. Transcription: local first, hosted fallback

The source code already includes Faster-Whisper and browser Whisper. Keep those as the default so the core feature does not require an API key. Benchmark Spanish accents, crosstalk, laughter, music beds and noisy studio audio; word-level timestamps; speaker separation where available; and recovery after cancellation, network loss and large files.

Define a provider interface such as transcribe(audio, language, hints, timestamps) with normalized output:
{ language, segments: [{start,end,text,words:[{start,end,text}],speaker?}], engine, confidence? }.

Groq is a reasonable fast hosted fallback. OpenAI's current recommended file model is gpt-transcribe at a listed $0.0045/minute. OpenAI's current docs say whisper-1, gpt-4o-transcribe and gpt-4o-mini-transcribe are deprecated with shutdown scheduled for 2027-02-26; do not build a new integration on those model IDs. Verify timestamp/diarization output compatibility before selecting a provider; changing model IDs alone does not preserve word-level subtitle behavior.

### 2. Clip selection: deterministic candidate generation + optional AI reranking

Do not let an LLM decide all timestamps. Use two stages:
1. Deterministic candidate windows from transcript boundaries, pauses, sentence completion, speaker turns, scene cuts and audio energy.
2. Optional Gemini reranking of a small candidate list using a rubric: hook strength, standalone context, completeness, emotional/informational payoff, low dependence on missing prior context, no mid-sentence cuts, and target duration.

Return strict JSON with source in/out, transcript span IDs, score, rationale, hook/title, context warning and confidence. Validate every timestamp against source duration and sentence boundaries in code. Human can accept/edit/reject. Store model/version/prompt and candidate evidence for reproducibility.

### 3. Video understanding: use as a targeted second pass

Gemini supports video inputs and timestamped descriptions. Its documented static mode samples frames at 1 FPS, which may miss fast gestures, quick cuts and short visual reactions. Therefore:
- First transcribe and create candidates locally.
- Extract selected keyframes and optionally short candidate ranges.
- Ask the model to describe visual context and whether the frame supports the spoken moment.
- Keep transcript timing authoritative; visual AI may suggest, never silently move, clip boundaries.
- Never send an entire long source to a paid multimodal model by default.

### 4. YouTube: separate metadata/publishing from source-media rights

Use YouTube Data API v3 for public metadata and user-authorized channel operations. Use API key only for public data; OAuth 2.0 for private channel data and writes such as uploads. Keep OAuth tokens encrypted server-side and owned by one ClipForge user/channel, with state/CSRF validation, refresh/revoke handling and RLS.

Important compliance boundary: YouTube's Developer Policies prohibit downloading/importing/backing up/storing copies of YouTube audiovisual content without prior written approval, and prohibit using the API to facilitate extraction of video/audio tracks. A YouTube API key or OAuth grant is not a general download permission. For editor source media, prefer files the user uploads or content they own and have rights/authorization to process; use official embed/metadata features where appropriate. Review current terms and any separate written permissions before enabling URL-to-file import.

### 5. Storage and Render are the real production gate

The audit found SQLite and local project/media files, no attached persistent disk, and frontend/API routing and backend JWT enforcement still need end-to-end validation. Render Free services are intended for testing/hobby use and have limitations; Render persistent disks are paid. Supabase Free currently lists 500 MB database, 1 GB file storage, 5 GB egress and a 50 MB max upload. That is enough for an MVP metadata test, not a video library.

Before production:
- Put users, projects, edit-decision documents, job metadata and provider connections in Supabase Postgres with RLS.
- Put media in object storage with signed URLs, resumable/chunked uploads, lifecycle cleanup and per-user ownership.
- Do not store video binaries in Postgres.
- Make upload size/duration/retention limits visible in UI.
- Keep a local development adapter and migration/backup path.
- Decide whether the product is a no-cost demo (small uploads, ephemeral files) or a durable video editor; durable media storage and compute cannot be promised at €0 indefinitely.

## Integration order

### P0 — make the existing product work (no new provider)
1. One canonical frontend/API origin and a Playwright network test for every API call.
2. Validate Supabase JWT on every protected API route; enforce project/job/media ownership.
3. Durable project/job/media persistence strategy and cleanup.
4. Import an authorized uploaded MP4; ffprobe validation; resumable/cancel/retry.
5. Reliable transcription with word timestamps and SRT/VTT.
6. Canonical edit-decision schema shared by editor preview, autosave, reload and FFmpeg export.
7. Real export parity fixture: multiple clips, split/trim, subtitles, crop, second audio track, volume, fades, effects; compare MP4 duration, frame samples, audio and subtitle timing.

### P1 — quality improvements
1. MediaPipe face tracking smoothing, no-face fallback, orientation and safe-area tests.
2. Transcript candidate scoring and user feedback loop.
3. Optional Gemini reranking behind feature flag, rate limits and per-user quotas.
4. Groq or OpenAI transcription fallback with explicit user/provider configuration.
5. Structured job telemetry and useful user-facing error/retry states.

### P2 — creator workflow
1. YouTube OAuth per user/channel.
2. Channel metadata/analytics and upload/publish flow, with quota tracking and explicit confirmation.
3. Script/title/description/hashtags assistant using the same provider adapter; drafts only, user approves.
4. Optional Gemini visual analysis of selected ranges.
5. Optional Drive export only if users request it; not required for core MP4 download.

## Explicitly do not add now

- Fal, Replicate, Hugging Face hosted generation, Pollinations, ElevenLabs, or a catalogue of image/video generators to the core clip editor. Existing AutoTube logs show paid HTTP 402, credit/unsupported-task failures and shared GPU quota cooldowns. Those are not needed to transcribe, select, edit or export source footage.
- A second timeline/editor framework or a second render engine.
- A second database/auth system or AutoTube's process-global youtube_connections.id=default token.
- Paid render/transcription/video-AI APIs enabled by default.
- Automated YouTube URL downloading as a feature unless legal/policy rights are established independently of API credentials.

## Acceptance tests before enabling a provider

- Contract tests with mocked responses and malformed/timeout/rate-limit cases.
- Secrets only in server environment; never in JS bundles, localStorage or logs.
- Per-user rate limits, spend ceilings, provider disable switch and fallback behavior.
- Golden Spanish audio set with word-timing accuracy checks.
- Clip selection tests that reject sentence truncation and missing context.
- Real export parity E2E.
- Provider off/unavailable still leaves upload, timeline editing and MP4 export usable.

## Official documentation consulted

- OpenAI speech-to-text workflow and model lifecycle: https://developers.openai.com/api/docs/guides/speech-to-text
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- Groq speech-to-text and model tradeoffs: https://console.groq.com/docs/speech-to-text
- Gemini video understanding: https://ai.google.dev/gemini-api/docs/video-understanding
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing/
- MediaPipe Face Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- YouTube Data API overview/quota: https://developers.google.com/youtube/v3/getting-started
- YouTube OAuth guidance: https://developers.google.com/youtube/data/guides/authentication
- YouTube Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- Supabase pricing/limits: https://supabase.com/pricing
- Render pricing and free service limitations: https://render.com/pricing and https://render.com/docs/free

No API credentials were added, no paid billing was enabled, and no production services or database schemas were changed as part of this research.

# ClipForge consolidation inventory

Audit date: 2026-11-15

## Purpose

Keep one canonical development line and one controlled production line. Preserve every historical branch and service until its changes have been compared and validated. This inventory is intentionally non-destructive.

## Canonical locations

- GitHub repository: `hugoaguilera022/ClipForge`
- Canonical integration target: `codex/clipforge-editor-stabilization`
- Render workspace: `Autotube` (`tea-dasrcurbc2fs73a12d90`)
- Static editor service: `clipforge-final` (`srv-dbooid2jnfac73fihk10`)
- API service: `clipforge-api-hugo` (`srv-dbs3p96i0phs73c1prc0`)

## Render service map

Services in Autotube associated with ClipForge:

| Service | Configured branch | Role |
|---|---|---|
| clipforge-final | codex/clipforge-editor-stabilization | Static editor |
| clipforge-api-hugo | codex/clipforge-editor-stabilization | API |
| clipforge-youtube-importer | integrated-web-final | YouTube importer |
| clipforge-youtube-ingest | integrated-web-final | YouTube ingest |
| clipforge-preview | integrated-web-final | Preview |

The separate `autotube` service belongs to AutoTube and must not be merged into ClipForge.

Audit of Render workspace `Hugo's workspace` found no service named ClipForge and no service whose configured repository is `hugoaguilera022/ClipForge`. Do not create duplicate services there.

## Git branches requiring preservation and comparison

High-priority branches:

- `main`
- `integrated-web-final` (large historical line; do not merge wholesale)
- `codex/clipforge-editor-stabilization` (current Render editor/API branch)
- `codex/clipforge-reference-editor` (four-panel reference UI)
- `browser-only-migration` (browser-only workflow)
- `clipforge-studio-rebuild` (large editor rebuild history)
- `codex/semantic-editorial-final`
- `codex/semantic-source-deploy`
- `codex/clipforge-capcut-workspace`

Additional focused branches exist for audio mixing/mute, subtitle parity/style, face tracking, media recovery, timeline multiselect/group drag, keyframes, waveforms, playback continuity, snapping, context menus, keyboard shortcuts, and export controls. Keep all branches until their unique commits and file changes are accounted for.

## Pull requests and validation status

- PR #63, `codex/clipforge-reference-editor` -> `codex/clipforge-editor-stabilization`: open and mergeable, but CI run 43755871345 failed. It reported 33 failed and 212 passed tests; the Chromium and media-fixture steps were skipped. Do not merge or deploy until failures are fixed and a complete green run exists.
- PR #61 (production branch sync): open, currently not mergeable.
- PR #50 (CPU/WASM semantic fallback): open, currently not mergeable.
- PR #7 (canonical multipista project store): draft and mergeable; review against already merged editor-core work before considering.
- PR #8, #32 and #38: already merged; do not re-integrate their changes blindly.
- PR #53: closed without merge; inspect its changes only if needed.

## Other workspaces and data

- Supabase: one active project named AutoTube was found; `public.clipforge_user_settings` exists with RLS enabled. Do not create a second Supabase project or modify unrelated AutoTube tables.
- Railway: the ClipForge workspace currently has no projects. Do not create duplicate services.
- Render Hugo's workspace: no ClipForge service found.

## Consolidation rules

1. Never force-push or rewrite existing branch history.
2. Never delete historical branches, services, databases, or deployments as part of consolidation.
3. Compare branch changes by unique commits and changed files; cherry-pick or port only validated, non-duplicate changes.
4. Merge one coherent feature group at a time into `codex/clipforge-editor-stabilization`.
5. Require Python tests, JavaScript checks, Chromium browser regression, and real MP4 export verification before production deployment.
6. Keep the Render editor/API on the canonical branch. Retarget importer/ingest/preview only after confirming their required code and runtime configuration are compatible with that branch.
7. Deploy only the static editor after its validated merge unless an independently validated API change is required.
8. Keep AutoTube resources separate from ClipForge.

## Known blockers

- PR #63 CI failure includes a missing timeline video block in a keyframe interpolation test and an assertion mismatch in semantic fallback messaging. The browser and media-fixture steps did not run.
- The current branch topology is divergent: some branches contain large numbers of commits and cannot be safely merged as whole branches.
- The full branch-by-branch uniqueness audit and the service-by-service compatibility check are still pending. This file is a durable map, not a claim that consolidation is complete.

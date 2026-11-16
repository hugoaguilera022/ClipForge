# ClipForge Studio agent instructions

Read these documents before coding, in this order:
1. `docs/CLIPFORGE_STUDIO_MASTER_SPEC.md`
2. `docs/CLIPFORGE_STUDIO_CONSOLIDATION_PLAN.md`
3. `docs/CLIPFORGE_STUDIO_CODEX_HANDOFF.md`

- ClipForge is the primary product/editor. AutoTube is a source of selectively reusable YouTube/AI workflow modules.
- Keep relaxscape-studio out of scope.
- Work on feature branches; do not commit to production branches.
- Inspect before replacing; preserve existing features; avoid wholesale rewrites.
- No paid services, billing activation or recurring spend without explicit approval. Target €0/month additional spend.
- Never commit secrets or expose API keys in frontend bundles.
- Do not alter production Render settings, domains, branches, env vars, Supabase schemas or OAuth settings until migration is tested and approved.
- Do not delete/archive source repositories or services during consolidation.
- Preserve AutoTube's free limits and paid-provider kill switches. Do not copy its autonomous repair/watchdog/long-running E2E workflows wholesale.
- Do not reuse AutoTube's process-global YouTube token as a ClipForge multi-user auth model.
- Treat the two ClipForge YouTube importer services as possible duplicates only; prove usage and dependency before any consolidation.
- Verify persistent storage: ClipForge's SQLite/project files are local files and Render service inventory showed no attached persistent disk.

Workflow: establish a clean baseline; fix current CI failures; inventory deployed SHAs, routes, env var NAMES, data and callbacks; add regression tests; integrate AutoTube behind feature flags and versioned API contracts; maintain one canonical edit-decision model for timeline/preview/export; mock external APIs; run unit/integration/Playwright tests; deploy an isolated preview; document rollback.

Done means existing ClipForge workflows pass, YouTube workflows work through ClipForge without duplicate/shared auth, projects persist across restart/redeploy under a documented storage strategy, preview matches exported MP4, no secret leaks or paid activation, and cutover is reversible.

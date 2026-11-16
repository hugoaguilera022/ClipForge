# ClipForge Studio agent instructions

Read `docs/CLIPFORGE_STUDIO_MASTER_SPEC.md` and `docs/CLIPFORGE_STUDIO_CONSOLIDATION_PLAN.md` before coding.

- ClipForge is the primary product/editor. AutoTube is a source of selectively reusable YouTube/AI workflow modules.
- Keep relaxscape-studio out of scope.
- Work on feature branches; do not commit to production branches.
- Inspect before replacing; preserve existing features; avoid wholesale rewrites.
- No paid services, billing activation or recurring spend without explicit approval. Target €0/month additional spend.
- Never commit secrets or expose API keys in frontend bundles.
- Do not alter production Render settings, domains, branches, env vars, Supabase schemas or OAuth settings until migration is tested and approved.
- Do not delete/archive source repositories or services during consolidation.

Workflow: inventory deployed SHAs, routes, env vars, data and callbacks; add regression tests; integrate AutoTube behind feature flags and API contracts; maintain one canonical edit-decision model for timeline/preview/export; mock external APIs; run unit/integration/Playwright tests; deploy preview; document rollback.

Done means existing ClipForge workflows pass, YouTube workflows work through ClipForge without duplicate auth, projects persist, preview matches exported MP4, no secret leaks or paid activation, and cutover is reversible.

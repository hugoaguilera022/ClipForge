# Instructions for coding agents — ClipForge Studio

Read `docs/CLIPFORGE_STUDIO_MASTER_SPEC.md` and `docs/CLIPFORGE_STUDIO_CONSOLIDATION_PLAN.md` before making changes.

## Working rules
- ClipForge is the primary editor and product. AutoTube is a source of selectively reusable YouTube/AI workflow modules.
- Keep `relaxscape-studio` out of scope.
- Work on a feature branch; never commit directly to production branches.
- Preserve existing features. Inspect before replacing. Avoid wholesale rewrites.
- No paid services, paid model calls, billing activation or recurring spend without explicit approval. Target €0/month additional spend.
- Never commit secrets or expose API keys in frontend bundles.
- Do not change Render production service configuration, domains, branches, environment variables, Supabase schemas or OAuth settings until a tested migration plan is approved.
- Do not delete or archive source repositories/services during consolidation.

## Required workflow
1. Inventory repository tree, active branches, deployed SHAs, routes, env vars, database usage and external callbacks.
2. Add tests around existing ClipForge workflows before refactoring.
3. Integrate AutoTube features behind explicit feature flags and documented API contracts.
4. Keep a single canonical project/edit-decision representation shared by timeline, preview and export.
5. Add tests for all new functionality; mock external APIs.
6. Run lint, unit, integration and Playwright E2E tests; report exact commands and outcomes.
7. Deploy preview only after tests pass; provide rollback instructions.

## Definition of done
- Existing ClipForge editor workflows still pass.
- YouTube import/OAuth/publish functions are available through ClipForge without duplicating auth/session state.
- Projects save and reopen correctly.
- Preview and exported MP4 match.
- No secret leaks or paid provider activation.
- Production cutover is reversible and old services remain available until verified.

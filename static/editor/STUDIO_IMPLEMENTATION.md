# ClipForge Studio

This branch is the isolated implementation target for the editor rebuild.

## Required architecture
- Keep the production branch `integrated-web-final` untouched.
- Use one canonical project state for timeline, selected clip, preview, inspector and export.
- Retain the local transcription and browser MP4 render paths.
- Use permanent editor workspace regions: media/tool rail, preview, contextual inspector and multi-track timeline.
- Track types: video, audio, subtitles, text, image and effects.
- All edits must be reversible and persisted in the project.
- Do not claim audio mixing, transitions or effects are export-complete until parity tests pass.

## Acceptance tests
1. Open and switch between four candidate clips without duplicated cards or listeners.
2. Edit caption text/times and verify preview, project JSON and exported MP4.
3. Add independent music/audio tracks, mute source audio, and verify mixed export.
4. Add text/effect layers and compare preview with export.
5. Split, trim, drag, copy, paste, duplicate, delete, undo and redo.
6. Save/reload and verify all tracks, asset references and clip metadata.
7. Verify keyboard controls, responsive layout and no console errors.

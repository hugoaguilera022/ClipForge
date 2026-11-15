from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"


def test_capcut_editor_enhancements_are_loaded_after_core_editor():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    core = html.index('src="/capcut-editor.js')
    enhanced = html.index('src="/capcut-editor-enhancements.js')
    assert enhanced > core


def test_editor_exposes_named_project_and_real_timeline_controls():
    core = (STATIC / "capcut-editor.js").read_text(encoding="utf-8")
    enhanced = (STATIC / "capcut-editor-enhancements.js").read_text(encoding="utf-8")
    assert 'id="cfNleName"' in core
    assert 'data-track' in core
    assert "cfNleAddAudio" in enhanced
    assert "cfNleAddVideo" in enhanced
    assert "cf-nle-trim" in enhanced
    assert "locked" in enhanced and "muted" in enhanced and "hidden" in enhanced


def test_drive_saves_named_projects_without_forcing_json_download():
    drive = (STATIC / "google-drive.js").read_text(encoding="utf-8")
    assert "clipforge-project-'+clean+'.json'" in drive
    assert "uploadType=multipart" in drive
    assert "window.addEventListener('clipforge:new-project'" in drive
    assert "dl.hidden=true" in drive


def test_final_mp4_export_uses_full_timeline_composition():
    enhanced = (STATIC / "capcut-editor-enhancements.js").read_text(encoding="utf-8")
    assert "async function exportTimeline()" in enhanced
    assert "canvas.captureStream(30)" in enhanced
    assert "new MediaRecorder" in enhanced
    assert "fetch('/api/editor/export'" in enhanced
    assert "result.status_url" in enhanced
    assert "state?.status==='ready'" in enhanced
    assert "Convirtiendo a MP4" in enhanced
    assert "drawImage(el" in enhanced
    assert "TRANSFORMACIÓN Y EFECTOS" not in enhanced or "outlineWidth" in enhanced


def test_timeline_export_includes_audio_mix_and_captions():
    enhanced = (STATIC / "capcut-editor-enhancements.js").read_text(encoding="utf-8")
    assert "createMediaElementSource" in enhanced
    assert "createMediaStreamDestination" in enhanced
    assert "const texts=items.filter(x=>(x.track.type==='text'||x.track.type==='subtitles')" in enhanced
    assert "fadeIn" in enhanced and "fadeOut" in enhanced


def test_legacy_platform_panel_is_optional_after_workspace_redesign():
    app = (STATIC / "app.js").read_text(encoding="utf-8")
    assert "const host=$('#platforms');if(!host)return;" in app
    assert "if(host.isConnected)" in app


def test_service_worker_invalidates_old_workspace_and_caches_current_editor():
    worker = (STATIC / "sw.js").read_text(encoding="utf-8")
    assert "clipforge-web-v173" in worker
    assert "'/capcut-editor-enhancements.js'" in worker
    assert "'/workspace-ui-v4.js'" in worker


def test_app_registers_versioned_service_worker_path():
    app = (STATIC / "app.js").read_text(encoding="utf-8")
    worker = (STATIC / "sw-v173.js").read_text(encoding="utf-8")
    assert "navigator.serviceWorker.register('/sw-v173.js')" in app
    assert "clipforge-web-v173" in worker


def test_vertical_editor_preview_fills_canvas_like_mp4_export():
    editor = (STATIC / "capcut-editor.js").read_text(encoding="utf-8")
    assert ".cf-nle-monitor video,.cf-nle-monitor img{width:100%;height:100%;object-fit:cover}" in editor


def test_workspace_geometry_does_not_override_timeline_preview_crop():
    workspace = (STATIC / "workspace-ui-v4.js").read_text(encoding="utf-8")
    assert "querySelector('video:not(#cfNleVideo)')" in workspace


def test_video_inspector_uses_neutral_speed_and_transition_defaults():
    enhanced = (STATIC / "capcut-editor-enhancements.js").read_text(encoding="utf-8")
    assert "speed:1,transitionDuration:.5" in enhanced


def test_editor_mount_is_requested_after_workspace_replaces_editor_slot():
    core = (STATIC / "capcut-editor.js").read_text(encoding="utf-8")
    workspace = (STATIC / "workspace-ui-v4.js").read_text(encoding="utf-8")
    assert "window.addEventListener('clipforge:editor-open-request',open)" in core
    assert "queueMicrotask(()=>window.dispatchEvent(new CustomEvent('clipforge:editor-open-request'" in workspace
    assert workspace.index("editorSlot.replaceChildren()") < workspace.index("clipforge:editor-open-request")

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
    assert "drawImage(el" in enhanced
    assert "TRANSFORMACIÓN Y EFECTOS" not in enhanced or "outlineWidth" in enhanced


def test_timeline_export_includes_audio_mix_and_captions():
    enhanced = (STATIC / "capcut-editor-enhancements.js").read_text(encoding="utf-8")
    assert "createMediaElementSource" in enhanced
    assert "createMediaStreamDestination" in enhanced
    assert "tracks.filter(t=>(t.type==='text'||t.type==='subtitles')" in enhanced
    assert "fadeIn" in enhanced and "fadeOut" in enhanced

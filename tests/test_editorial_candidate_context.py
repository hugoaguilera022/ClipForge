from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_editorial_judge_sees_more_than_the_first_115_characters():
    js = (ROOT / "static/browser-whisper-inline-v3.js").read_text(encoding="utf-8")
    assert "function compactEditorialText(value, limit=220)" in js
    assert "dialogue:compactEditorialText(clip.text,220)" in js
    assert "before:compactEditorialText(clip.context_before,65)" in js
    assert "after:compactEditorialText(clip.context_after,65)" in js
    assert "transcript:String(clip.text||'').replace(/\\s+/g,' ').slice(0,115)" not in js


def test_editorial_judge_is_told_that_context_does_not_extend_the_clip():
    js = (ROOT / "static/browser-whisper-inline-v3.js").read_text(encoding="utf-8")
    assert "before y after son SOLO contexto; nunca amplíes el intervalo start/end" in js
    assert "before/after son contexto y no amplían el corte" in js


def test_editorial_bundle_cache_bust_changes_with_candidate_context_logic():
    html = (ROOT / "static/index.html").read_text(encoding="utf-8")
    assert "/browser-whisper-inline-v3.js?v=20261115-editorial-context1" in html

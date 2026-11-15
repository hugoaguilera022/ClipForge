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



def test_word_level_whisper_timestamps_still_produce_four_editorial_windows():
    import json
    import subprocess

    js = (ROOT / "static/browser-whisper-inline-v3.js").read_text(encoding="utf-8")
    start = js.index("function buildEditorialCandidatePool(")
    end = js.index("function compactEditorialText", start)
    function_source = js[start:end]
    transcript = [
        {"start": i * 0.51, "end": i * 0.51 + 0.4, "text": f"palabra{i}"}
        for i in range(900)
    ]
    script = (
        function_source
        + "\\nconst result=buildEditorialCandidatePool(" + json.dumps(transcript)
        + ",460.0,null,[],16000);"
        + "process.stdout.write(JSON.stringify(result));"
    )
    completed = subprocess.run(
        ["node", "-e", script], capture_output=True, text=True, check=True
    )
    candidates = json.loads(completed.stdout)
    assert len(candidates) >= 4
    assert all(18 <= item["duration"] <= 45 for item in candidates)
    assert all(item["text"] for item in candidates)

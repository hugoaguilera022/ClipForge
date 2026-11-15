from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_no_webgpu_path_uses_cpu_semantic_embeddings_before_heuristics():
    js = (ROOT / 'static' / 'browser-whisper-inline-v3.js').read_text(encoding='utf-8')
    assert 'async function selectEditorialSemanticFallback' in js
    assert 'semanticRerankCandidates(prepared,limit,onProgress)' in js
    assert 'selector heurístico local' in js
    assert "candidatePool = await selectEditorialSemanticFallback(candidatePool, requested, say)" in js
    assert "'local_semantic_fallback'" in js


def test_semantic_fallback_is_bounded_and_explicitly_not_generative():
    js = (ROOT / 'static' / 'browser-whisper-inline-v3.js').read_text(encoding='utf-8')
    assert 'const maxSemanticCandidates=32' in js
    assert 'embeddings multilingües ejecutados en el navegador; no es una selección generativa Qwen' in js
    assert 'not_run_semantic_fallback' in js


def test_semantic_fallback_is_accepted_by_candidate_validation_and_explained():
    js = (ROOT / 'static' / 'browser-whisper-inline-v3.js').read_text(encoding='utf-8')
    assert "'local_editorial_fallback','local_semantic_fallback'].includes(item.selection_method)" in js
    assert 'Selección local con embeddings semánticos y puntuación editorial transparente; no generativa.' in js


def test_semantic_model_is_forced_to_wasm_cpu_and_webgpu_is_checked_by_adapter():
    js = (ROOT / 'static' / 'browser-whisper-inline-v3.js').read_text(encoding='utf-8')
    assert "device: 'wasm'" in js
    assert 'navigator.gpu?.requestAdapter' in js
    assert 'No hay un adaptador WebGPU compatible; se activará la selección semántica CPU/WASM.' in js
    assert 'Selección semántica CPU/WASM' in js
    assert 'MiniLM CPU/WASM' in js

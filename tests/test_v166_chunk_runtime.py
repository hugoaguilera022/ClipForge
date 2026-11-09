"""Execute the actual browser chunking functions with a mocked Whisper model."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def test_real_chunk_execution_and_overlap(tmp_path):
    js = (ROOT / 'static/browser-whisper.js').read_text()
    fn = js[js.index('async function transcribeAudioInChunks('):js.index('Sample low-resolution frames')]
    vtt = js[js.index('function makeVtt('):js.index('\n// Las puntuaciones')]
    time_fn = js[js.index('function timeVtt('):js.index('\n// Extracts')]
    script = time_fn + '\n' + fn + '\n' + vtt + '''
(async () => {
  const calls = [], progress = [];
  const mock = async (_samples) => {
    const part = calls.length;
    calls.push(_samples.length);
    if (part === 0) return {text:'hola', chunks:[{timestamp:[27.2,27.6],text:'hola'}]};
    if (part === 1) return {text:'hola mundo', chunks:[{timestamp:[1.2,1.6],text:'hola'},{timestamp:[1.7,2.0],text:'mundo'},{timestamp:[0.2,0.7],text:'rescate'}]};
    return {text:'fin', chunks:[{timestamp:[0.5,0.8],text:'fin'}]};
  };
  const result = await transcribeAudioInChunks(mock, new Float32Array(213.34*16000), (pct, n, total) => progress.push([pct,n,total]));
  const words = result.chunks;
  if (calls.length !== 9) throw Error('Expected 9 chunks, got '+calls.length);
  if (words.filter(x=>x.text==='hola').length!==1) throw Error('overlap duplicate not removed');
  if (!words.some(x=>x.text==='rescate' && Math.abs(x.start-26.2)<.01)) throw Error('overlap-only word lost');
  if (!words.some(x=>x.text==='mundo' && Math.abs(x.start-27.7)<.01)) throw Error('absolute timestamp broken');
  if (progress.some((p,i)=>p[1]!==i+1 || p[2]!==9)) throw Error('progress total inconsistent');
  if (progress.at(-1)[0]!==100) throw Error('progress never completed');
  const captions = makeVtt(words);
  if (!captions.includes('00:00:26.200') || !captions.startsWith('WEBVTT')) throw Error('VTT failed');
  const natural = makeVtt([
    {start:0,end:.2,text:'Hola'}, {start:.2,end:.4,text:'qué'},
    {start:.4,end:.7,text:'tal?'}, {start:1.3,end:1.5,text:'Muy'},
    {start:1.5,end:1.8,text:'bien.'}, {start:2.5,end:2.8,text:'Gracias'}
  ]);
  if (!natural.includes('Hola qué tal?') || !natural.includes('Muy bien.') || !natural.includes('Gracias')) throw Error('natural caption grouping failed');
  if ((natural.match(/ --> /g)||[]).length !== 3) throw Error('pause/sentence boundaries were not respected');
  console.log('PASS: 213.34s, 9 chunks, overlap recovery, dedupe, absolute timestamps, VTT, progress');
})().catch(e=>{console.error(e);process.exit(1)});
'''
    test_file = tmp_path / 'runtime.cjs'
    test_file.write_text(script)
    run = subprocess.run(['node', str(test_file)], capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr

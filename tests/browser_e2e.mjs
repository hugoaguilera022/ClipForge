import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const base = process.env.CLIPFORGE_URL || 'http://127.0.0.1:8765';
const browser = await chromium.launch({ headless: true, args: ['--enable-features=PlatformHEVCDecoderSupport'] });
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
const browserLogs = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') browserLogs.push(message.text()); });
try {
  const response = await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
  if (!response?.ok()) throw new Error(`Web app returned HTTP ${response?.status()}`);
  await page.waitForFunction(() => document.body.dataset.browserOnly === 'true', undefined, {timeout:10000});
  const browserMode = await page.evaluate(() => ({
    hiddenServerPanels: ['.publish','.channel-panel','.inbox-panel','.history-panel'].every(selector => document.querySelector(selector)?.hidden),
    hiddenServerControls: ['.url-source','.transcript-drop','.form-grid','#submit','.browser-auto-generate'].every(selector => !document.querySelector(selector) || document.querySelector(selector).hidden),
    directUrlVisible: !document.querySelector('.browser-url-import')?.hidden,
    filePickerVisible: !!document.querySelector('#video') && !document.querySelector('#video').disabled
  }));
  if (!browserMode.hiddenServerPanels || !browserMode.hiddenServerControls || !browserMode.directUrlVisible || !browserMode.filePickerVisible) {
    throw new Error('Browser-only mode exposed unavailable server controls: '+JSON.stringify(browserMode));
  }
  if (await page.locator('#browserWhisperLanguage').inputValue() !== 'auto') {
    throw new Error('Browser transcription must default to automatic Spanish/English language detection.');
  }
  await page.locator('#video').setInputFiles('test-output/e2e-source.mkv');
  await page.waitForFunction(() => {
    const panel=document.querySelector('#videoCapacity');
    return panel && document.querySelector('#capacityRam')?.textContent.includes('GB') &&
      document.querySelector('#capacityGpu')?.textContent.includes('GB') &&
      document.querySelector('#capacityDisk')?.textContent.includes('GB');
  }, undefined, {timeout:20000});
  const capacity=await page.evaluate(()=>({
    status:document.querySelector('#capacityStatus')?.textContent,
    ram:document.querySelector('#capacityRam')?.textContent,
    gpu:document.querySelector('#capacityGpu')?.textContent,
    disk:document.querySelector('#capacityDisk')?.textContent,
    model:document.querySelector('#capacityModel')?.textContent
  }));
  if(!capacity.model?.includes('Qwen3') || !capacity.ram || !capacity.gpu || !capacity.disk) {
    throw new Error('Per-video capacity panel did not produce complete requirements: '+JSON.stringify(capacity));
  }

  const project = {
    schema: 'clipforge-browser-project-v1',
    source: 'e2e-source.mkv',
    transcript: { source: 'e2e-source.mkv', text: 'Prueba uno. Prueba dos. Prueba tres. Prueba cuatro.', segments: [
      {start:0.1,end:0.5,text:'Prueba uno'},
      {start:2.1,end:2.5,text:'Prueba dos'},
      {start:4.1,end:4.5,text:'Prueba tres'},
      {start:6.1,end:6.5,text:'Prueba cuatro'}
    ]},
    clips: [
      {id:'clip-1',start:0,end:0.8,title:'Prueba uno',selected:true},
      {id:'clip-2',start:2,end:2.8,title:'Prueba dos',selected:true},
      {id:'clip-3',start:4,end:4.8,title:'Prueba tres',selected:true},
      {id:'clip-4',start:6,end:6.8,title:'Prueba cuatro',selected:true}
    ]
  };
  await writeFile('test-output/e2e-project.json', JSON.stringify(project));
  await page.locator('#browserProjectImport').setInputFiles('test-output/e2e-project.json');
  await page.locator('#browserCandidates').waitFor({state:'visible', timeout:10000});
  // Exercise the editable export controls and the centered portrait crop path.
  await page.locator('#captionPosition').selectOption('top');
  await page.locator('#captionColor').selectOption('white');
  await page.locator('#captionBackground').selectOption('none');
  await page.locator('#captionSize').selectOption('6.2');
  await page.locator('#browserCropMode').selectOption('center');
  const projectState = await page.locator('#browserWhisperStatus').innerText();
  if (!projectState.includes('Proyecto recuperado')) throw new Error('Browser project import did not complete: '+projectState);

  // Open the real Studio editor, not only the legacy candidate exporter.
  await page.locator('.candidate-card .cf-open-clip-editor').first().click();
  await page.locator('.cf-studio-shell').waitFor({state:'visible',timeout:10000});
  await page.waitForFunction(()=>window.ClipForgeStudio?.getProject?.()?.tracks?.length>=7,undefined,{timeout:10000});
  const initialStudio=await page.evaluate(()=>({
    rows:document.querySelectorAll('.cf-studio-track-row').length,
    clips:document.querySelectorAll('.cf-studio-track-row:first-child .cf-studio-block').length,
    hasPreview:!!document.querySelector('.cf-studio-video'),
    api:typeof window.ClipForgeStudio?.open
  }));
  if(initialStudio.rows!==7||initialStudio.clips!==4||!initialStudio.hasPreview||initialStudio.api!=='function'){
    throw new Error('Studio did not mount the full project timeline: '+JSON.stringify(initialStudio));
  }

  // Edit video, title and music in the same project state.
  await page.locator('.cf-studio-track-row').first().locator('.cf-studio-block').first().click();
  await page.locator('.cf-studio-inspector select[data-field="preset"]').selectOption('cinematic');
  await page.locator('.cf-studio-inspector input[data-field="opacity"]').fill('85');
  await page.locator('.cf-studio-track-row').nth(4).locator('.cf-studio-block').first().click();
  await page.locator('.cf-studio-inspector select[data-field="stylePreset"]').selectOption('karaoke');
  await page.locator('.cf-studio-tools [data-action="addtext"]').click();
  await page.locator('.cf-studio-track-row').nth(5).locator('.cf-studio-block').first().click();
  await page.locator('.cf-studio-inspector input[data-field="text"]').fill('PRUEBA CLIPFORGE');
  await page.locator('.cf-studio-import input').setInputFiles('test-output/studio-music.wav');
  await page.waitForFunction(()=>[...document.querySelectorAll('.cf-studio-track-row')].some(row=>row.innerText.includes('A2')&&row.querySelectorAll('.cf-studio-block').length>0),undefined,{timeout:15000});
  await page.locator('.cf-studio-tools [data-tool="media"]').click();
  await page.locator('.cf-studio-media-dialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('.cf-studio-media-library .cf-studio-media-row').length>=2,undefined,{timeout:10000});
  await page.locator('.cf-studio-media-dialog [data-action="media-close"]').click();

  // Check split + undo on the selected video clip, not the previously edited title.
  await page.locator('.cf-studio-track-row').first().locator('.cf-studio-block').first().click();
  await page.locator('.cf-studio-ruler').click({position:{x:15,y:10}});
  await page.locator('.cf-studio-actions [data-cmd="split"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.cf-studio-track-row:first-child .cf-studio-block').length===5,undefined,{timeout:5000});
  await page.locator('.cf-studio-topbar [data-action="undo"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.cf-studio-track-row:first-child .cf-studio-block').length===4,undefined,{timeout:5000});

  const studioState=await page.evaluate(()=>({
    tracks:window.ClipForgeStudio.getProject().tracks.map(t=>({type:t.type,items:t.items.length})),
    title:window.ClipForgeStudio.getProject().tracks.find(t=>t.type==='text')?.items?.[0]?.text,
    filter:window.ClipForgeStudio.getProject().tracks.find(t=>t.type==='video')?.items?.[0]?.visualEffects?.preset,
    opacity:window.ClipForgeStudio.getProject().tracks.find(t=>t.type==='video')?.items?.[0]?.opacity,
    subtitleStyle:window.ClipForgeStudio.getProject().tracks.find(t=>t.type==='subtitles')?.items?.[0]?.style
  }));
  if(!studioState.tracks.some(t=>t.type==='audio'&&t.items.length>0)||studioState.title!=='PRUEBA CLIPFORGE'||studioState.filter!=='cinematic'||studioState.opacity!==85||studioState.subtitleStyle?.wordMode!=='highlight'){
    throw new Error('Studio edits did not persist in the canonical project state: '+JSON.stringify(studioState));
  }

  // Close and reopen the same source: edits and imported audio must survive a reload of the editor view.
  await page.locator('.cf-studio-topbar [data-action="back"]').click();
  await page.locator('.cf-studio-shell').waitFor({state:'hidden',timeout:10000});
  await page.locator('.candidate-card .cf-open-clip-editor').first().click();
  await page.locator('.cf-studio-shell').waitFor({state:'visible',timeout:10000});
  await page.waitForFunction(()=>{
    const p=window.ClipForgeStudio?.getProject?.();
    const v=p?.tracks?.find(t=>t.type==='video')?.items?.[0];
    const a=p?.tracks?.filter(t=>t.type==='audio').flatMap(t=>t.items||[]);
    const text=p?.tracks?.find(t=>t.type==='text')?.items?.[0]?.text;
    const sub=p?.tracks?.find(t=>t.type==='subtitles')?.items?.[0]?.style;
    return v?.visualEffects?.preset==='cinematic'&&v.opacity===85&&a?.some(i=>i.assetId)&&text==='PRUEBA CLIPFORGE'&&sub?.wordMode==='highlight';
  },undefined,{timeout:15000});

  // Attach rejection handling immediately: an unhandled Playwright timeout can terminate Node while the render is still running.
  const downloadPromise = page.waitForEvent('download', { timeout: 300000 }).then(download => ({download}), error => ({error}));
  await page.locator('.cf-studio-topbar [data-action="export"]').click();
  const status = page.locator('#browserExportStatus');
  await status.waitFor({ state:'visible' });
  await page.waitForFunction(() => {
    const el=document.querySelector('#browserExportStatus');
    return el && /Exportación (terminada|detenida):/.test(el.textContent);
  }, undefined, { timeout: 180000 });
  const exportMessage = await status.innerText();
  if (!exportMessage.includes('Exportación terminada:')) {
    throw new Error(exportMessage + (errors.length ? ' | Page errors: '+errors.join('; ') : '') + (browserLogs.length ? ' | Console: '+browserLogs.join('; ') : ''));
  }
  const outcome = await downloadPromise;
  if (outcome.error) {
    throw new Error('La exportación terminó, pero Playwright no detectó la descarga: ' + outcome.error.message + ' | Estado: ' + exportMessage + (browserLogs.length ? ' | Console: '+browserLogs.join('; ') : ''));
  }
  const download = outcome.download;
  await download.saveAs('test-output/browser-export.zip');
  const inspect = spawnSync('python', ['-c', "import zipfile; z=zipfile.ZipFile('test-output/browser-export.zip'); names=z.namelist(); assert len(names)==4, names; [z.extract(n,'test-output/exported') for n in names]; print(names)"], {encoding:'utf8'});
  if (inspect.status !== 0) throw new Error(inspect.stderr || inspect.stdout);
  const probe = spawnSync('bash', ['-lc', 'set -e; for f in test-output/exported/*.mp4; do ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 "$f" | grep -E "^h264,1080,1920$"; ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$f" | grep -qx aac; done'], {encoding:'utf8'});
  if (probe.status !== 0) throw new Error('Exported MP4 validation failed: '+probe.stderr+probe.stdout);
  const audioCheck=spawnSync('python',['-c',String.raw`import subprocess,struct,math,sys
f='test-output/exported/clipforge-01.mp4'
raw=subprocess.run(['ffmpeg','-v','error','-i',f,'-map','0:a:0','-f','f32le','-ac','1','-ar','48000','pipe:1'],check=True,stdout=subprocess.PIPE).stdout
samples=struct.unpack('<%df'%(len(raw)//4),raw)
rate=48000
def amplitude(freq):
 n=min(len(samples),int(rate*.35))
 re=im=0.0
 for i,x in enumerate(samples[:n]):
  angle=2*math.pi*freq*i/rate
  re+=x*math.cos(angle);im-=x*math.sin(angle)
 return 2*math.hypot(re,im)/max(1,n)
amps={f:amplitude(f) for f in (440,660)}
print(amps)
assert amps[440]>.01 and amps[660]>.01,amps
`],{encoding:'utf8'});
  if(audioCheck.status!==0)throw new Error('The mixed export is missing the original or added music signal: '+audioCheck.stderr+audioCheck.stdout);
  console.log('Browser E2E passed: project import, Studio editing, split/undo, imported music, four H.264 1080x1920 MP4 exports and mixed AAC audio.');
  if (errors.length) throw new Error('Browser page errors: '+errors.join('; '));
} finally {
  await browser.close();
}

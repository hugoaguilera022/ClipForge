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
    hiddenServerPanels: ['.publish','.channel-panel','.inbox-panel','.history-panel'].every(selector => { const el=document.querySelector(selector); return !el || el.hidden || getComputedStyle(el).display==='none'; }),
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
  const projectState = await page.locator('#browserWhisperStatus').innerText();
  if (!projectState.includes('Proyecto recuperado')) throw new Error('Browser project import did not complete: '+projectState);

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



  // Exercise the actual clip inspector and multipista editor.
  await page.locator('.candidate-card').first().locator('.cf-open-clip-editor').click();
  await page.locator('#cfMultiTrackTimeline').waitFor({state:'visible',timeout:10000});
  // Exercise editor actions through the visible inspector and keyboard shortcuts.
  const videoClips=page.locator('#cfMultiTrackTimeline .cf-mt-clip.type-video');
  const initialVideoClipCount=await videoClips.count();
  if(initialVideoClipCount<1)throw new Error('No video clip is visible on the editing timeline.');
  const initialVideoIds=await page.evaluate(()=>window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items.map(x=>x.id));
  // The synthetic clips are sub-second long; zoom in so their minimum visual
  // widths do not overlap and intercept each other's pointer targets.
  await page.locator('#cfMultiTrackTimeline .cf-mt-zoom input').evaluate(el=>{el.value='24';el.dispatchEvent(new Event('input',{bubbles:true}));});
  const firstClipStart=await page.evaluate(()=>window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items[0].start);
  await videoClips.first().click();
  const afterSelectStart=await page.evaluate(()=>window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items[0].start);
  if(afterSelectStart!==firstClipStart)throw new Error('A simple click unexpectedly moved the selected clip.');
  await page.keyboard.press('Control+d');
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n+1,initialVideoClipCount);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n,initialVideoClipCount);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n+1,initialVideoClipCount);
  // Select the duplicate by its canonical ID: it intentionally overlaps
  // the source clip by 0.25 s, so pointer hit-testing is ambiguous there.
  await page.evaluate(ids=>{
    const items=window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items;
    const duplicate=items.find(item=>!ids.includes(item.id));
    if(!duplicate)throw new Error('The duplicate clip was not created.');
    window.clipforgeProjectStore.select([duplicate.id]);
  },initialVideoIds);
  await page.keyboard.press('Delete');
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n,initialVideoClipCount);

  // The visible timeline toolbar must perform the same edit commands.
  await page.locator('#cfMultiTrackTimeline .cf-mt-clip.type-video').first().click();
  const splitPoint=await page.evaluate(()=>{
    const item=window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items[0];
    window.clipforgeProjectStore.setPlayhead((item.start+item.end)/2);
    return (item.start+item.end)/2;
  });
  await page.locator('#cfMultiTrackTimeline [data-act="split"]').click();
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n+1,initialVideoClipCount);
  await page.locator('#cfMultiTrackTimeline [data-act="undo"]').click();
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n,initialVideoClipCount);
  await page.locator('#cfMultiTrackTimeline [data-act="redo"]').click();
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n+1,initialVideoClipCount);

  // Dragging a clip changes its timeline position; dragging its edge trims it.
  await page.locator('#cfMultiTrackTimeline .cf-mt-zoom input').evaluate(el=>{el.value='24';el.dispatchEvent(new Event('input',{bubbles:true}));});
  const beforeMove=await page.evaluate(()=>{
    const item=window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items[0];
    return {id:item.id,start:item.start,end:item.end,sourceStart:item.sourceStart};
  });
  const movingClip=page.locator('#cfMultiTrackTimeline .cf-mt-clip.type-video').first();
  await movingClip.scrollIntoViewIfNeeded();
  const moveBox=await movingClip.boundingBox();
  await page.mouse.move(moveBox.x+moveBox.width/2,moveBox.y+moveBox.height/2);
  await page.mouse.down();
  await page.mouse.move(moveBox.x+moveBox.width/2+24,moveBox.y+moveBox.height/2,{steps:4});
  await page.mouse.up();
  await page.waitForFunction(({id,start})=>{
    const item=window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items.find(x=>x.id===id);
    return item&&Math.abs(item.start-(start+1))<.08;
  },{id:beforeMove.id,start:beforeMove.start});
  const moved=await page.evaluate(id=>window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items.find(x=>x.id===id),beforeMove.id);
  if(moved.sourceStart!==beforeMove.sourceStart)throw new Error('Moving a clip changed its source media in-point.');
  const rightHandle=page.locator('#cfMultiTrackTimeline [data-item-id="'+beforeMove.id+'"] .cf-mt-handle.right');
  const edgeBox=await rightHandle.boundingBox();
  await page.mouse.move(edgeBox.x+edgeBox.width/2,edgeBox.y+edgeBox.height/2);
  await page.mouse.down();
  await page.mouse.move(edgeBox.x+edgeBox.width/2+12,edgeBox.y+edgeBox.height/2,{steps:3});
  await page.mouse.up();
  await page.waitForFunction(({id,end})=>{
    const item=window.clipforgeProjectStore.project.tracks.find(t=>t.type==='video').items.find(x=>x.id===id);
    return item&&Math.abs(item.end-(end+.5))<.1;
  },{id:beforeMove.id,end:moved.end});

  const visibleVideoClips=page.locator('#cfMultiTrackTimeline .cf-mt-clip.type-video');
  await visibleVideoClips.nth(0).click();
  await visibleVideoClips.nth(1).click({modifiers:['Shift']});
  const multiSelection=await page.evaluate(()=>window.clipforgeProjectStore.project.selection.length);
  if(multiSelection!==2)throw new Error('Shift-click did not select two timeline clips.');
  await page.locator('#cfMultiTrackTimeline [data-act="copy"]').click();
  await page.evaluate(()=>window.clipforgeProjectStore.setPlayhead(10));
  await page.locator('#cfMultiTrackTimeline [data-act="paste"]').click();
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n+2,initialVideoClipCount);
  await page.locator('#cfMultiTrackTimeline [data-act="delete"]').click();
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n+1,initialVideoClipCount);
  // Roll back the five temporary video edits so the export assertion remains four clips.
  for(let i=0;i<5;i++)await page.locator('#cfMultiTrackTimeline [data-act="undo"]').click();
  await page.waitForFunction(n=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-video').length===n,initialVideoClipCount);

  await page.locator('.cf-opus-tab[data-tab="captions"]').click();
  const subtitleRows=page.locator('.cf-subtitle-row-button');
  if(await subtitleRows.count()<1)throw new Error('The subtitle editor did not load the imported timestamped transcript.');
  await subtitleRows.first().click();
  await page.locator('.cf-subtitle-single-editor textarea').fill('Prueba uno corregida');
  await page.locator('.cf-subtitle-single-editor button').first().click();
  if(!(await subtitleRows.first().innerText()).includes('Prueba uno corregida')) {
    throw new Error('Editing a subtitle did not update its visible transcript row.');
  }
  const subtitleCount=await subtitleRows.count();
  await page.locator('.cf-subtitle-edit-actions button').filter({hasText:'Duplicar'}).click();
  await page.waitForFunction(n=>document.querySelectorAll('.cf-subtitle-row-button').length===n+1,subtitleCount);
  await page.locator('.cf-subtitle-edit-actions button').filter({hasText:'Eliminar'}).click();
  await page.waitForFunction(n=>document.querySelectorAll('.cf-subtitle-row-button').length===n,subtitleCount);

  await page.locator('.cf-opus-tab[data-tab="text"]').click();
  await page.locator('.cf-overlay-copy').fill('Texto de prueba editable');
  await page.locator('.cf-opus-add-overlay').click();
  await page.waitForFunction(()=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-text').length>=1);
  if(!await page.locator('#cfMultiTrackTimeline .cf-mt-clip.type-text').first().innerText().then(t=>t.includes('Texto de prueba editable'))) {
    throw new Error('The text inspector did not create a visible editable text item.');
  }

  await page.locator('.cf-opus-tab[data-tab="effects"]').click();
  await page.locator('.cf-video-filter').selectOption('cinematic');
  if(!(await page.locator('.cf-inline-player video').evaluate(el=>el.style.filter.includes('contrast(1.14)')))) {
    throw new Error('The cinematic filter did not apply to the preview.');
  }
  await page.locator('.cf-opus-tab[data-tab="transitions"]').click();
  await page.locator('.cf-transition-in').selectOption('fade');
  await page.locator('.cf-transition-in').dispatchEvent('change');
  await page.locator('.cf-opus-tab[data-tab="tracking"]').click();
  await page.locator('#browserCropMode').selectOption('center');
  const trackRows=page.locator('#cfMultiTrackTimeline .cf-mt-track-row');
  if(await trackRows.count()<7)throw new Error('The editor did not create all canonical video/audio/subtitle/text/effects tracks.');
  await page.locator('#cfMultiTrackTimeline [data-act="add-audio"]').click();
  if(await trackRows.count()<8)throw new Error('The Add audio track action did not add a new lane.');
  await page.locator('#cfMultiTrackTimeline .cf-mt-import input').setInputFiles('test-output/music.wav');
  await page.waitForFunction(()=>document.querySelectorAll('#cfMultiTrackTimeline .cf-mt-clip.type-audio').length>=5,undefined,{timeout:20000});
  const importedAudio=page.locator('#cfMultiTrackTimeline .cf-mt-clip.type-audio').last();
  await importedAudio.click();
  const volume=page.locator('#cfMultiTrackTimeline .cf-mt-volume input');
  await volume.waitFor({state:'visible'});
  await volume.evaluate(el=>{el.value='60';el.dispatchEvent(new Event('input',{bubbles:true}));});
  const audioGain=await volume.inputValue();
  if(audioGain!=='60')throw new Error('The imported audio volume control did not apply.');
  await page.locator('.cf-opus-back').click();
  await page.locator('#cfResults').waitFor({state:'visible'});

  // Attach rejection handling immediately: an unhandled Playwright timeout can terminate Node while the render is still running.
  const downloadPromise = page.waitForEvent('download', { timeout: 300000 }).then(download => ({download}), error => ({error}));
  await page.locator('.cf-opus-export-all').click();
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

  // Reload the app and verify that timeline/text/effect edits survive IndexedDB recovery.
  await page.waitForTimeout(800);
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.clipforgeProjectStore?.ready===true,undefined,{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#browserWhisperStatus')?.textContent.includes('Proyecto recuperado'),undefined,{timeout:15000});
  const recovered=await page.evaluate(()=>{
    const p=window.clipforgeProjectStore.project;
    return {
      textItems:p.tracks.find(t=>t.type==='text')?.items?.map(x=>x.text||x.name)||[],
      filter:p.clips?.[0]?.visualEffects?.preset,
      transition:p.clips?.[0]?.transitions?.in
    };
  });
  if(!recovered.textItems.some(x=>x==='Texto de prueba editable')||recovered.filter!=='cinematic'||recovered.transition!=='fade') {
    throw new Error('Project recovery did not preserve text/filter/transition edits: '+JSON.stringify(recovered));
  }
  console.log('Browser E2E passed: timeline edit commands, subtitle editing, text/filter/transition edits, IndexedDB recovery and four MP4 exports.');
  if (errors.length) throw new Error('Browser page errors: '+errors.join('; '));
} finally {
  await browser.close();
}

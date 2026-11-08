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
  await page.locator('#video').setInputFiles('test-output/e2e-source.webm');
  const project = {
    schema: 'clipforge-browser-project-v1',
    source: 'e2e-source.webm',
    transcript: { source: 'e2e-source.webm', text: 'Prueba uno. Prueba dos. Prueba tres. Prueba cuatro.', segments: [
      {start:0.1,end:1.2,text:'Prueba uno'},
      {start:2.1,end:3.2,text:'Prueba dos'},
      {start:4.1,end:5.2,text:'Prueba tres'},
      {start:6.1,end:7.2,text:'Prueba cuatro'}
    ]},
    clips: [
      {id:'clip-1',start:0,end:1.8,title:'Prueba uno',selected:true},
      {id:'clip-2',start:2,end:3.8,title:'Prueba dos',selected:true},
      {id:'clip-3',start:4,end:5.8,title:'Prueba tres',selected:true},
      {id:'clip-4',start:6,end:7.8,title:'Prueba cuatro',selected:true}
    ]
  };
  await writeFile('test-output/e2e-project.json', JSON.stringify(project));
  await page.locator('#browserProjectImport').setInputFiles('test-output/e2e-project.json');
  await page.locator('#browserCandidates').waitFor({state:'visible', timeout:10000});
  const projectState = await page.locator('#browserWhisperStatus').innerText();
  if (!projectState.includes('Proyecto recuperado')) throw new Error('Browser project import did not complete: '+projectState);
  // Attach rejection handling immediately: an unhandled Playwright timeout can terminate Node while the render is still running.
  const downloadPromise = page.waitForEvent('download', { timeout: 300000 }).then(download => ({download}), error => ({error}));
  await page.locator('#browserExportClips').click();
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
  console.log('Browser E2E passed: project import, four MP4 exports, H.264 1080x1920 and AAC.');
  if (errors.length) throw new Error('Browser page errors: '+errors.join('; '));
} finally {
  await browser.close();
}

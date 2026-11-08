// Browser-only MP4 export. All decoding, crop, captions and encoding stay on-device.
const exportButton=document.querySelector('#browserExportClips');
const exportStatus=document.querySelector('#browserExportStatus');
const sayExport=message=>{if(exportStatus)exportStatus.textContent=message;};

function buildCaptionCues(segments){
  const words=(segments||[]).filter(s=>Number.isFinite(Number(s.start))&&Number.isFinite(Number(s.end))&&Number(s.end)>Number(s.start)&&String(s.text||'').trim())
    .map(s=>({start:Number(s.start),end:Number(s.end),text:String(s.text).trim()})).sort((a,b)=>a.start-b.start);
  const cues=[];let group=[];
  const flush=()=>{if(group.length)cues.push(group);group=[];};
  for(const word of words){
    const prev=group[group.length-1];
    if(group.length&&(group.length>=5||word.start-prev.end>.38||word.end-group[0].start>2.1||/[.!?…]$/.test(prev.text)))flush();
    group.push(word);
    if(/[.!?…]$/.test(word.text))flush();
  }
  flush();return cues;
}
function drawKaraokeCaption(ctx,cues,sourceTime,width,height){
  const cue=cues.find(words=>sourceTime>=words[0].start&&sourceTime<=words[words.length-1].end+.18);
  if(!cue)return;
  const fontSize=Math.round(width*.052),lineHeight=Math.round(fontSize*1.2),maxWidth=width*.86;
  ctx.save();ctx.font=`800 ${fontSize}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const lines=[];let line=[],lineWidth=0;
  for(const word of cue){
    const w=ctx.measureText(word.text+' ').width;
    if(line.length&&lineWidth+w>maxWidth){lines.push(line);line=[];lineWidth=0;}
    line.push(word);lineWidth+=w;
  }
  if(line.length)lines.push(line);
  const visible=lines.slice(-2),blockHeight=visible.length*lineHeight,pad=fontSize*.42;
  const y0=height*.78-blockHeight/2;
  ctx.fillStyle='rgba(0,0,0,.66)';ctx.beginPath();
  const boxW=Math.min(maxWidth+pad*2,width*.94),boxH=blockHeight+pad*2;
  const x=(width-boxW)/2,y=y0-pad,r=Math.round(fontSize*.22);
  ctx.roundRect(x,y,boxW,boxH,r);ctx.fill();
  visible.forEach((words,index)=>{
    const total=words.reduce((n,w)=>n+ctx.measureText(w.text+' ').width,0);
    let xPos=width/2-total/2;
    const y=y0+index*lineHeight+lineHeight/2;
    for(const word of words){
      const text=word.text+' ',w=ctx.measureText(text).width;
      const active=sourceTime>=word.start&&sourceTime<=word.end+.06;
      ctx.fillStyle=active?'#ffe16b':'#ffffff';
      ctx.fillText(text,xPos+w/2,y,maxWidth);
      xPos+=w;
    }
  });
  ctx.restore();
}

async function exportOne(file,clip,segments,index,total){
  const {Input,Output,Conversion,ALL_FORMATS,BlobSource,Mp4OutputFormat,BufferTarget,Quality}=await import('https://esm.sh/mediabunny@1.65.2');
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  const output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()});
  const cues=buildCaptionCues(segments);
  let canvas=null,ctx=null;
  const conversion=await Conversion.init({
    input,output,tracks:'primary',
    trim:{start:clip.start,end:clip.end},
    video:{
      width:1080,height:1920,fit:'cover',frameRate:30,codec:'avc',
      quality:new Quality('high'),hardwareAcceleration:'prefer-hardware',
      process:sample=>{
        if(!canvas){canvas=new OffscreenCanvas(sample.displayWidth,sample.displayHeight);ctx=canvas.getContext('2d',{alpha:false});}
        ctx.clearRect(0,0,canvas.width,canvas.height);
        sample.draw(ctx,0,0);
        const stamp=Number(sample.timestamp)||0;
        const local=stamp>=clip.start-.5?stamp-clip.start:stamp;
        drawKaraokeCaption(ctx,cues,local,canvas.width,canvas.height);
        return canvas;
      },
      processedWidth:1080,processedHeight:1920
    },
    audio:{codec:'aac',quality:new Quality('high'),numberOfChannels:2,sampleRate:48000}
  });
  if(!conversion.isValid){
    const reasons=(conversion.discardedTracks||[]).map(x=>x.reason).join(', ');
    throw new Error(`El navegador no puede codificar todas las pistas MP4 de este vídeo (${reasons||'códec no compatible'}).`);
  }
  conversion.onProgress=p=>sayExport(`Clip ${index+1}/${total}: renderizando ${Math.round(p*100)}%…`);
  await conversion.execute();
  const buffer=output.target.buffer;
  if(!buffer||buffer.byteLength<1024)throw new Error('El render terminó sin generar un MP4 válido.');
  const blob=new Blob([buffer],{type:'video/mp4'});
  return {blob,bytes:blob.size,duration:clip.end-clip.start,name:`clipforge-${String(index+1).padStart(2,'0')}.mp4`};
}

exportButton?.addEventListener('click',async()=>{
  const file=document.querySelector('#video')?.files?.[0];
  const project=window.clipforgeEditorBridge?.getProject?.();
  const clips=(project?.clips||[]).filter(c=>Number.isFinite(Number(c.start))&&Number.isFinite(Number(c.end))&&Number(c.start)>=0&&Number(c.end)>Number(c.start));
  const segments=project?.transcript?.segments||[];
  if(!file){sayExport('Selecciona el MP4 original antes de exportar.');return;}
  if(!clips.length){sayExport('No hay cortes válidos. Primero transcribe el vídeo y selecciona momentos.');return;}
  const expected=String(project?.source||'').split(/[\\/]/).pop();
  if(expected&&expected!==file.name){sayExport(`El proyecto corresponde a ${expected}; has seleccionado ${file.name}. Para evitar exportar el vídeo equivocado, selecciona el original.`);return;}
  if(!('VideoEncoder'in window)||!('AudioEncoder'in window)||!('OffscreenCanvas'in window)){sayExport('Este navegador no ofrece WebCodecs/OffscreenCanvas. Usa Chrome o Edge actualizado.');return;}
  exportButton.disabled=true;
  const results=[];
  try{
    for(let i=0;i<clips.length;i++){
      const clip={start:Number(clips[i].start),end:Number(clips[i].end)};
      if(clip.end>36000)throw new Error('Un corte supera el límite de seguridad de 10 horas.');
      results.push(await exportOne(file,clip,segments,i,clips.length));
    }
    sayExport('Preparando paquete ZIP con los MP4…');
    const JSZip=(await import('https://esm.sh/jszip@3.10.1')).default;
    const zip=new JSZip();
    results.forEach(item=>zip.file(item.name,item.blob));
    const archive=await zip.generateAsync({type:'blob',compression:'STORE'});
    const url=URL.createObjectURL(archive),a=document.createElement('a');
    a.href=url;a.download='clipforge-exportacion-mp4.zip';
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    const totalBytes=results.reduce((n,x)=>n+x.bytes,0);
    sayExport(`Exportación terminada: ${results.length} MP4 en un ZIP · 1080×1920 · 30 fps · H.264/AAC · ${(totalBytes/1024/1024).toFixed(1)} MB de vídeo.`);
  }catch(error){console.error(error);sayExport(`Exportación detenida: ${error.message}. No se ha enviado el vídeo a ningún servidor.`);}
  finally{exportButton.disabled=false;}
});

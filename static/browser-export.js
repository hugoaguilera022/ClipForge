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
function drawTextLayers(ctx,tracks,sourceTime,width,height){
  const layers=(tracks||[]).filter(t=>t.type==='text').flatMap(t=>t.items||[])
    .filter(item=>Number.isFinite(Number(item.start))&&Number.isFinite(Number(item.end))&&sourceTime>=Number(item.start)&&sourceTime<=Number(item.end)&&String(item.text||'').trim());
  if(!layers.length)return;
  ctx.save();
  layers.forEach((item,index)=>{
    const fontSize=Math.round(width*.052),text=String(item.text).trim().slice(0,180);
    ctx.font=`800 ${fontSize}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    const maxWidth=width*.86,lines=[];let line='';
    for(const word of text.split(/\s+/)){
      const next=line?line+' '+word:word;
      if(line&&ctx.measureText(next).width>maxWidth){lines.push(line);line=word;}else line=next;
    }
    if(line)lines.push(line);
    const visible=lines.slice(0,3),lineHeight=fontSize*1.2,pad=fontSize*.45;
    const y=height*.22+index*(lineHeight*visible.length+pad*2);
    const boxW=Math.min(maxWidth+pad*2,Math.max(...visible.map(x=>ctx.measureText(x).width))+pad*2);
    const boxH=visible.length*lineHeight+pad*2,x=(width-boxW)/2;
    ctx.fillStyle='rgba(0,0,0,.68)';ctx.fillRect(x,y,boxW,boxH);
    ctx.fillStyle='#fff';visible.forEach((lineText,i)=>ctx.fillText(lineText,width/2,y+pad+lineHeight*(i+.5),maxWidth));
  });
  ctx.restore();
}
function drawKaraokeCaption(ctx,cues,sourceTime,width,height,settings={}){
  const cue=cues.find(words=>sourceTime>=words[0].start&&sourceTime<=words[words.length-1].end+.18);
  if(!cue)return;
  const fontSize=Math.round(width*(Number(settings.captionSize)||5.2)/100),lineHeight=Math.round(fontSize*1.2),maxWidth=width*.86;
  ctx.save();ctx.font=`800 ${fontSize}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const lines=[];let line=[],lineWidth=0;
  for(const word of cue){
    const w=ctx.measureText(word.text+' ').width;
    if(line.length&&lineWidth+w>maxWidth){lines.push(line);line=[];lineWidth=0;}
    line.push(word);lineWidth+=w;
  }
  if(line.length)lines.push(line);
  const visible=lines.slice(-2),blockHeight=visible.length*lineHeight,pad=fontSize*.42;
  const y0=(settings.captionPosition==='top'?height*.16:height*.78)-blockHeight/2;
  if(settings.captionBackground!=='none'){ctx.fillStyle=settings.captionBackground==='solid'?'rgba(0,0,0,1)':'rgba(0,0,0,.66)';ctx.beginPath();
  const boxW=Math.min(maxWidth+pad*2,width*.94),boxH=blockHeight+pad*2;
  const x=(width-boxW)/2,y=y0-pad,r=Math.round(fontSize*.22);
  if(typeof ctx.roundRect==='function'){ctx.roundRect(x,y,boxW,boxH,r);ctx.fill();}else{ctx.fillRect(x,y,boxW,boxH);}}
  visible.forEach((words,index)=>{
    const total=words.reduce((n,w)=>n+ctx.measureText(w.text+' ').width,0);
    let xPos=width/2-total/2;
    const y=y0+index*lineHeight+lineHeight/2;
    for(const word of words){
      const text=word.text+' ',w=ctx.measureText(text).width;
      const active=sourceTime>=word.start&&sourceTime<=word.end+.06;
      ctx.fillStyle=settings.captionColor==='white'?'#ffffff':(settings.captionColor==='yellow-solid'?'#ffe16b':(active?'#ffe16b':'#ffffff'));
      ctx.fillText(text,xPos+w/2,y,maxWidth);
      xPos+=w;
    }
  });
  ctx.restore();
}

async function exportOne(file,clip,segments,tracks,index,total,settings={}){
  const {Input,Output,Conversion,ALL_FORMATS,BlobSource,Mp4OutputFormat,BufferTarget,Quality}=await import('https://esm.sh/mediabunny@1.65.2');
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  const sourceDuration=await input.getDurationFromMetadata();
  if(!Number.isFinite(sourceDuration)||sourceDuration<=0)throw new Error('No se pudo verificar la duración del vídeo original.');
  if(clip.start<0||clip.end<=clip.start||clip.start>=sourceDuration||clip.end>sourceDuration+.05){
    throw new Error(`El corte ${index+1} (${clip.start.toFixed(2)}–${clip.end.toFixed(2)} s) queda fuera de la duración real del vídeo (${sourceDuration.toFixed(2)} s).`);
  }
  // Keep the original compressed audio track whenever MP4 supports it.
  // This avoids unnecessary lossy re-encoding and does not require an AAC encoder.
  const output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()});
  const cues=buildCaptionCues(segments);
  let canvas=null,ctx=null,sourceCanvas=null,sourceCtx=null,faceDetector=null;
  let lastFaceCenter=null,frameNumber=0,multiFace=false,faceSamples=0,trackingMode='sin seguimiento';
  const sourceTrack=await input.getPrimaryVideoTrack();
  const sourceWidth=Number(sourceTrack?.displayWidth||sourceTrack?.width||1920);
  const sourceHeight=Number(sourceTrack?.displayHeight||sourceTrack?.height||1080);
  const portraitCropWidth=sourceHeight*9/16;
  const trackingPossible=settings.cropMode!=='center'&&settings.cropMode!=='blur'&&sourceWidth>portraitCropWidth*1.05;
  if(trackingPossible){
    try{
      sayExport(`Clip ${index+1}/${total}: cargando detector facial gratuito…`);
      const vision=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs');
      const fileset=await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm');
      faceDetector=await vision.FaceDetector.createFromOptions(fileset,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'},runningMode:'VIDEO',minDetectionConfidence:.48});
      trackingMode='detector facial activo';
    }catch(error){console.warn('Face tracking unavailable; using safe blurred background:',error);faceDetector=null;}
  }
  const conversion=await Conversion.init({
    input,output,tracks:'primary',
    trim:{start:clip.start,end:clip.end},
    video:{
      width:1080,height:1920,fit:'cover',frameRate:30,codec:'avc',
      quality:new Quality('high'),hardwareAcceleration:'no-preference',
      process:sample=>{
        // The returned canvas MUST have the same 9:16 dimensions advertised
        // by processedWidth/processedHeight. Drawing at source dimensions here
        // caused a landscape canvas to be passed to a portrait encoder.
        if(!canvas){
          canvas=new OffscreenCanvas(1080,1920);ctx=canvas.getContext('2d',{alpha:false});
          const detectorWidth=Math.min(640,Math.round(sourceWidth));
          const detectorHeight=Math.max(1,Math.round(detectorWidth*sourceHeight/sourceWidth));
          sourceCanvas=new OffscreenCanvas(detectorWidth,detectorHeight);sourceCtx=sourceCanvas.getContext('2d',{willReadFrequently:true});
        }
        ctx.clearRect(0,0,canvas.width,canvas.height);
        const stamp=Number(sample.timestamp)||0;
        if(faceDetector&&sourceCanvas){
          sourceCtx.clearRect(0,0,sourceCanvas.width,sourceCanvas.height);
          sample.drawWithFit(sourceCtx,{fit:'contain'});
          frameNumber++;
          if(frameNumber%6===1||lastFaceCenter===null){
            const detections=faceDetector.detectForVideo(sourceCanvas,Math.max(0,Math.round(stamp*1000)));
            const faces=detections?.detections||[];
            if(faces.length)faceSamples++;
            multiFace=faces.length>1;
            if(faces.length===1){
              const box=faces[0].boundingBox;
              const center=(Number(box.originX)+Number(box.width)/2)*sourceWidth/sourceCanvas.width;
              lastFaceCenter=lastFaceCenter===null?center:lastFaceCenter*.68+center*.32;
            }else if(faces.length===0){lastFaceCenter=null;}
          }
        }
        if(settings.cropMode==='center'&&sourceCanvas){\n          const cropWidth=Math.min(sourceCanvas.width,sourceCanvas.height*9/16);\n          const left=Math.max(0,(sourceCanvas.width-cropWidth)/2);\n          ctx.drawImage(sourceCanvas,left,0,cropWidth,sourceCanvas.height,0,0,1080,1920);\n        }else if(faceDetector&&sourceCanvas&&lastFaceCenter!==null&&!multiFace){
          const cropWidth=Math.min(sourceCanvas.width,sourceCanvas.height*9/16);
          const center=lastFaceCenter*sourceCanvas.width/sourceWidth;
          const left=Math.max(0,Math.min(sourceCanvas.width-cropWidth,center-cropWidth/2));
          ctx.drawImage(sourceCanvas,left,0,cropWidth,sourceCanvas.height,0,0,1080,1920);
        }else{
          // When dialogue has multiple faces or tracking is unavailable, retain
          // the complete shot over a blurred fill instead of cutting a speaker off.
          ctx.save();ctx.filter='blur(24px)';sample.drawWithFit(ctx,{fit:'cover'});ctx.restore();
          sample.drawWithFit(ctx,{fit:'contain'});
        }
        // Mediabunny normalizes timestamps to zero after trim; captions keep source-video times.
        const local=clip.start+stamp;
        drawTextLayers(ctx,tracks,local,canvas.width,canvas.height);
        drawKaraokeCaption(ctx,cues,local,canvas.width,canvas.height,settings);
        return canvas;
      },
      processedWidth:1080,processedHeight:1920
    },
  });
  if(!conversion.isValid){
    const reasons=(conversion.discardedTracks||[]).map(x=>x.reason).join(', ');
    throw new Error(`El navegador no puede codificar todas las pistas MP4 de este vídeo (${reasons||'códec no compatible'}).`);
  }
  conversion.onProgress=p=>sayExport(`Clip ${index+1}/${total}: renderizando ${Math.round(p*100)}%…`);
  try{await conversion.execute();}finally{faceDetector?.close?.();}
  const buffer=output.target.buffer;
  if(!buffer||buffer.byteLength<1024)throw new Error('El render terminó sin generar un MP4 válido.');
  const blob=new Blob([buffer],{type:'video/mp4'});
  return {blob,bytes:blob.size,duration:clip.end-clip.start,trackingMode,faceSamples,name:`clipforge-${String(index+1).padStart(2,'0')}.mp4`};
}

exportButton?.addEventListener('click',async()=>{
  const file=document.querySelector('#video')?.files?.[0];
  const project=window.clipforgeEditorBridge?.getProject?.();
  const clips=(project?.clips||[]).filter(c=>c.selected!==false&&Number.isFinite(Number(c.start))&&Number.isFinite(Number(c.end))&&Number(c.start)>=0&&Number(c.end)>Number(c.start));
  const segments=project?.transcript?.segments||[];
  const tracks=project?.tracks||[];
  if(!file){sayExport('Selecciona el MP4 original antes de exportar.');return;}
  if(!clips.length){sayExport('No hay clips seleccionados para exportar. Marca al menos uno en la lista de momentos.');return;}
  const expected=String(project?.source||'').split(/[\\/]/).pop();
  if(expected&&expected!==file.name){sayExport(`El proyecto corresponde a ${expected}; has seleccionado ${file.name}. Para evitar exportar el vídeo equivocado, selecciona el original.`);return;}
  if(!('VideoEncoder'in window)||!('OffscreenCanvas'in window)){sayExport('Este navegador no ofrece WebCodecs/OffscreenCanvas. Usa Chrome o Edge actualizado.');return;}
  exportButton.disabled=true;
  const results=[];
  try{
    for(let i=0;i<clips.length;i++){
      const clip={start:Number(clips[i].start),end:Number(clips[i].end)};
      if(clip.end>36000)throw new Error('Un corte supera el límite de seguridad de 10 horas.');
      results.push(await exportOne(file,clip,segments,tracks,i,clips.length,settings));
    }
    if(results.length===1){
      const url=URL.createObjectURL(results[0].blob),a=document.createElement('a');
      a.href=url;a.download=results[0].name;
      document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      sayExport(`Exportación terminada: 1 MP4 individual · 1080×1920 · 30 fps · H.264 + audio original · ${results[0].trackingMode}${results[0].faceSamples?' · rostro detectado':' · encuadre seguro sin rostro detectado'} · ${(results[0].bytes/1024/1024).toFixed(1)} MB.`);
      return;
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
    sayExport(`Exportación terminada: ${results.length} MP4 en un ZIP · 1080×1920 · 30 fps · H.264 + audio original · ${results.some(x=>x.faceSamples)?'seguimiento facial':'encuadre seguro'} · ${(totalBytes/1024/1024).toFixed(1)} MB de vídeo.`);
  }catch(error){console.error(error);sayExport(`Exportación detenida: ${error.message}. No se ha enviado el vídeo a ningún servidor.`);}
  finally{exportButton.disabled=false;}
});

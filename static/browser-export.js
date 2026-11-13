// Browser-only MP4 export. All decoding, crop, captions and encoding stay on-device.
const exportButton=document.querySelector('#browserExportClips');
const exportStatus=document.querySelector('#browserExportStatus');
const sayExport=message=>{if(exportStatus)exportStatus.textContent=message;};

function buildCaptionCues(segments){
  const words=[];
  for(const segment of segments||[]){
    const start=Number(segment.start),end=Number(segment.end),text=String(segment.text||'').trim();
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!text)continue;
    const tokens=text.split(/\s+/).filter(Boolean);
    if(!tokens.length)continue;
    // Reuse Whisper word timings only while they still describe the edited text.
    // If the user changes a sentence, old word tokens are stale: redistribute the
    // edited words across the same verified phrase interval instead of exporting
    // the pre-edit transcript or treating the whole sentence as one karaoke word.
    const sourceWords=Array.isArray(segment.words)?segment.words:[];
    const sourceText=sourceWords.map(w=>String(w.word||w.text||'').trim()).filter(Boolean).join(' ');
    const normalize=value=>String(value||'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
    const reusable=sourceWords.length===tokens.length&&normalize(sourceText)===normalize(text)&&sourceWords.every(w=>Number.isFinite(Number(w.start))&&Number.isFinite(Number(w.end))&&Number(w.end)>Number(w.start));
    const style=segment.style||null;
    if(reusable){
      sourceWords.forEach((word,i)=>words.push({start:Math.max(start,Number(word.start)),end:Math.min(end,Number(word.end)),text:tokens[i],style}));
    }else{
      const weights=tokens.map(token=>Math.max(1,token.replace(/[^\p{L}\p{N}]/gu,'').length));
      const total=weights.reduce((a,b)=>a+b,0);let cursor=start;
      tokens.forEach((token,i)=>{const next=i===tokens.length-1?end:cursor+(end-start)*weights[i]/total;words.push({start:cursor,end:next,text:token,style});cursor=next;});
    }
  }
  const ordered=words.filter(w=>w.end>w.start).sort((a,b)=>a.start-b.start);
  const cues=[];let group=[];
  const flush=()=>{if(group.length)cues.push(group);group=[];};
  for(const word of ordered){
    const prev=group[group.length-1];
    if(group.length&&(group.length>=5||word.start-prev.end>.38||word.end-group[0].start>2.1||/[.!?…]$/.test(prev.text)))flush();
    group.push(word);
    if(/[.!?…]$/.test(word.text))flush();
  }
  flush();return cues;
}
function drawImageLayers(ctx,tracks,timelineTime,width,height,bitmaps){
  const layers=(tracks||[]).filter(t=>t.type==="image"&&!t.hidden).flatMap(t=>t.items||[])
    .filter(item=>!item.hidden&&item.assetId&&timelineTime>=Number(item.start)&&timelineTime<=Number(item.end));
  for(const item of layers){
    const bitmap=bitmaps.get(item.assetId);if(!bitmap)continue;
    const w=width*Math.max(.05,Math.min(.95,Number(item.widthPct)||30))/100;
    const h=w*(bitmap.height/Math.max(1,bitmap.width));
    const x=width*Math.max(0,Math.min(100,Number(item.x??50)))/100;
    const y=height*Math.max(0,Math.min(100,Number(item.y??50)))/100;
    ctx.save();ctx.globalAlpha=Math.max(0,Math.min(1,Number(item.opacity??100)/100));
    ctx.translate(x,y);ctx.rotate((Number(item.rotation)||0)*Math.PI/180);
    ctx.drawImage(bitmap,-w/2,-h/2,w,h);ctx.restore();
  }
}
function drawTextLayers(ctx,tracks,sourceTime,width,height){
  const layers=(tracks||[]).filter(t=>t.type==='text'&&!t.hidden).flatMap(t=>t.items||[])
    .filter(item=>!item.hidden&&Number.isFinite(Number(item.start))&&Number.isFinite(Number(item.end))&&sourceTime>=Number(item.start)&&sourceTime<=Number(item.end)&&String(item.text||'').trim());
  if(!layers.length)return;
  ctx.save();
  layers.forEach((item,index)=>{
    const fontSize=Math.max(18,Math.min(240,Math.round(Number(item.fontSize)||width*.052))),text=String(item.text).trim().slice(0,180);
    ctx.font=(item.bold===false?'500':'800')+' '+fontSize+'px '+(item.font||'system-ui')+', sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    const maxWidth=width*.86,lines=[];let line='';
    for(const word of text.split(/\s+/)){
      const next=line?line+' '+word:word;
      if(line&&ctx.measureText(next).width>maxWidth){lines.push(line);line=word;}else line=next;
    }
    if(line)lines.push(line);
    const visible=lines.slice(0,3),lineHeight=fontSize*1.2,pad=fontSize*.45;
    const xCenter=width*Math.max(0,Math.min(100,Number(item.x??50)))/100;
    const yCenter=height*Math.max(0,Math.min(100,Number(item.y??22)))/100+index*(lineHeight*visible.length+pad*2);
    const boxW=Math.min(maxWidth+pad*2,Math.max(...visible.map(x=>ctx.measureText(x).width))+pad*2);
    const boxH=visible.length*lineHeight+pad*2,x=xCenter-boxW/2,y=yCenter-boxH/2;
    if(item.background&&item.background!=='transparent'){ctx.fillStyle=item.background;ctx.fillRect(x,y,boxW,boxH);}
    ctx.fillStyle=item.color||'#fff';
    if(item.outline&&Number(item.outlineWidth)>0){ctx.strokeStyle=item.outline;ctx.lineWidth=Math.max(1,Math.min(24,Number(item.outlineWidth)*2));visible.forEach((lineText,i)=>ctx.strokeText(lineText,xCenter,yCenter-boxH/2+pad+lineHeight*(i+.5),maxWidth));}
    visible.forEach((lineText,i)=>ctx.fillText(lineText,xCenter,yCenter-boxH/2+pad+lineHeight*(i+.5),maxWidth));
  });
  ctx.restore();
}
function drawKaraokeCaption(ctx,cues,sourceTime,width,height,settings={}){
  const cue=cues.find(words=>sourceTime>=words[0].start&&sourceTime<=words[words.length-1].end+.18);
  if(!cue)return;
  const style=cue[0]?.style||settings.subtitleStyle||null,fontSize=style?Math.round((Number(style.size)||28)*3):Math.round(width*(Number(settings.captionSize)||5.2)/100),lineHeight=Math.round(fontSize*1.2),maxWidth=width*.86;
  ctx.save();ctx.font=`${style?.bold===false?400:800} ${fontSize}px ${style?.font||'system-ui'}, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const lines=[];let line=[],lineWidth=0;
  for(const word of cue){
    const w=ctx.measureText(word.text+' ').width;
    if(line.length&&lineWidth+w>maxWidth){lines.push(line);line=[];lineWidth=0;}
    line.push(word);lineWidth+=w;
  }
  if(line.length)lines.push(line);
  const visible=lines.slice(-2),blockHeight=visible.length*lineHeight,pad=fontSize*.42;
  const position=style?.position||settings.captionPosition||'bottom';const y0=(position==='top'?height*.16:position==='middle'?height*.5:height*.78)-blockHeight/2;
  if((style?.background&&style.background!=='transparent')||(!style&&settings.captionBackground!=='none')){
    ctx.fillStyle=(style?.background&&style.background!=='transparent')?style.background:(settings.captionBackground==='solid'?'rgba(0,0,0,1)':'rgba(0,0,0,.66)');
    const boxW=Math.min(maxWidth+pad*2,width*.94),boxH=blockHeight+pad*2;
    const x=(width-boxW)/2,y=y0-pad,r=Math.round(fontSize*.22);
    ctx.beginPath();
    if(typeof ctx.roundRect==='function'){ctx.roundRect(x,y,boxW,boxH,r);ctx.fill();}else{ctx.fillRect(x,y,boxW,boxH);}
  }
  visible.forEach((words,index)=>{
    const total=words.reduce((n,w)=>n+ctx.measureText(w.text+' ').width,0);
    let xPos=width/2-total/2;
    const y=y0+index*lineHeight+lineHeight/2;
    for(const word of words){
      const text=word.text+' ',w=ctx.measureText(text).width;
      const active=sourceTime>=word.start&&sourceTime<=word.end+.06;
      const highlighted=style?.wordMode==='highlight'&&active;
      ctx.fillStyle=highlighted?(style.highlight||'#ffe600'):(style?.color|| (settings.captionColor==='white'?'#ffffff':(settings.captionColor==='yellow-solid'?'#ffe16b':'#ffffff')));
      if(style?.outlineWidth){ctx.strokeStyle=style.outline||'#080808';ctx.lineWidth=Math.max(1,Math.min(18,Number(style.outlineWidth)*3));ctx.strokeText(text,xPos+w/2,y,maxWidth);}
      if(style?.animation==='pop'&&active){ctx.save();ctx.translate(xPos+w/2,y);ctx.scale(1.06,1.06);ctx.fillText(text,0,0,maxWidth);ctx.restore();}else ctx.fillText(text,xPos+w/2,y,maxWidth);
      xPos+=w;
    }
  });
  ctx.restore();
}


const decodedAudioCache=new Map();
async function readAudioRegion(blob,key,start,end){
 const cacheKey=key+":"+Number(start).toFixed(3)+":"+Number(end).toFixed(3);
 if(decodedAudioCache.has(cacheKey))return decodedAudioCache.get(cacheKey);
 const {Input,BlobSource,ALL_FORMATS,AudioBufferSink}=await import("https://esm.sh/mediabunny@1.65.2");
 const input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});
 try{
  const track=await input.getPrimaryAudioTrack();
  if(!track)return [];
  const sink=new AudioBufferSink(track),chunks=[];
  for await(const entry of sink.buffers(Math.max(0,start),Math.max(start+.01,end))){
   chunks.push({buffer:entry.buffer,timestamp:Number(entry.timestamp)||0,duration:Number(entry.duration)||entry.buffer.duration});
  }
  decodedAudioCache.set(cacheKey,chunks);
  return chunks;
 }finally{input.dispose();}
}
function addMixedChunks(context,compressor,chunks,rangeStart,rangeEnd,outputStart,volume,fadeIn,fadeOut,itemStart,itemEnd,rangeTimelineStart){
 for(const chunk of chunks){
  const chunkStart=Number(chunk.timestamp)||0,chunkEnd=chunkStart+(Number(chunk.duration)||chunk.buffer.duration);
  const overlapStart=Math.max(rangeStart,chunkStart),overlapEnd=Math.min(rangeEnd,chunkEnd);
  if(overlapEnd<=overlapStart)continue;
  const sourceOffset=overlapStart-chunkStart,playable=overlapEnd-overlapStart;
  const at=outputStart+(overlapStart-rangeStart);
  const relative= itemStart+(overlapStart-rangeStart)-itemStart;
  const gain=context.createGain(),source=context.createBufferSource();source.buffer=chunk.buffer;
  const v=Math.max(0,Math.min(2,Number(volume)||0)),fin=Math.max(0,Number(fadeIn)||0),fout=Math.max(0,Number(fadeOut)||0);
  const timelineStart=rangeTimelineStart+(overlapStart-rangeStart);
  const timelineEnd=timelineStart+playable;
  const levelAt=time=>{
   const inGain=fin>0?Math.max(0,Math.min(1,(time-itemStart)/fin)):1;
   const outGain=fout>0?Math.max(0,Math.min(1,(itemEnd-time)/fout)):1;
   return v*inGain*outGain;
  };
  gain.gain.setValueAtTime(levelAt(timelineStart),at);
  const fadeInEnd=itemStart+fin;
  if(fin>0&&fadeInEnd>timelineStart&&fadeInEnd<timelineEnd)gain.gain.linearRampToValueAtTime(levelAt(fadeInEnd),at+(fadeInEnd-timelineStart));
  const fadeOutStart=itemEnd-fout;
  if(fout>0&&fadeOutStart>timelineStart&&fadeOutStart<timelineEnd)gain.gain.setValueAtTime(levelAt(fadeOutStart),at+(fadeOutStart-timelineStart));
  gain.gain.linearRampToValueAtTime(levelAt(timelineEnd),at+playable);
  source.connect(gain).connect(compressor);
  source.start(at,sourceOffset,playable);
 }
}
async function buildMixedAudioBuffer(file,clip,tracks){
 const duration=Math.max(.05,Number(clip.end)-Number(clip.start)),sampleRate=48000;
 const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
 if(!Offline)throw new Error("Este navegador no admite mezcla local (OfflineAudioContext).");
 const context=new Offline(2,Math.ceil(duration*sampleRate),sampleRate);
 const compressor=context.createDynamicsCompressor();compressor.threshold.value=-3;compressor.knee.value=8;compressor.ratio.value=3;compressor.attack.value=.004;compressor.release.value=.18;compressor.connect(context.destination);
 for(const track of (tracks||[]).filter(t=>t.type==="audio"&&!t.muted&&!t.hidden)){
  for(const item of track.items||[]){
   const itemStart=Number(item.start)||0,itemEnd=Number(item.end)||0;
   const overlapStart=Math.max(Number(clip.start),itemStart),overlapEnd=Math.min(Number(clip.end),itemEnd);
   if(overlapEnd<=overlapStart||Number(item.volume??1)<=0)continue;
   const outputStart=overlapStart-Number(clip.start);
   let blob,key,rangeStart,rangeEnd;
   if(item.source==="source-audio"){
    blob=file;key="video:"+file.name+":"+file.size+":"+file.lastModified;
    rangeStart=(Number(clip.sourceStart)||Number(clip.start)||0)+(overlapStart-Number(clip.start));
    rangeEnd=rangeStart+(overlapEnd-overlapStart);
   }else{
    if(!item.assetId)continue;
    blob=await window.ClipForgeStudio?.getAssetBlob?.(item.assetId);
    if(!blob)throw new Error("No se encuentra el archivo de audio "+(item.assetName||item.assetId)+". Vuelve a importarlo.");
    key="asset:"+item.assetId;
    rangeStart=(Number(item.sourceStart)||0)+(overlapStart-itemStart);
    rangeEnd=rangeStart+(overlapEnd-overlapStart);
   }
   const chunks=await readAudioRegion(blob,key,rangeStart,rangeEnd);
   addMixedChunks(context,compressor,chunks,rangeStart,rangeEnd,outputStart,Number(item.volume??1),Number(item.fadeIn)||0,Number(item.fadeOut)||0,itemStart,itemEnd,overlapStart);
  }
 }
 return await context.startRendering();
}

async function exportOne(file,clip,segments,tracks,index,total,settings={}){
  const {Input,Output,Conversion,ALL_FORMATS,BlobSource,Mp4OutputFormat,BufferTarget,Quality,AudioBufferSource,canEncodeAudio}=await import('https://esm.sh/mediabunny@1.65.2');
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  // MOV/MP4 files can be valid even when the container omits duration metadata.
  // Measure the primary video track before rejecting a usable source.
  const sourceTrack=await input.getPrimaryVideoTrack();
  const metadataDuration=await input.getDurationFromMetadata();
  const sourceDuration=Number.isFinite(metadataDuration)&&metadataDuration>0
    ? metadataDuration
    : await sourceTrack?.computeDuration();
  if(!Number.isFinite(sourceDuration)||sourceDuration<=0||sourceDuration>6*60*60){
    input.dispose();
    throw new Error('No se pudo verificar la duración del vídeo original mediante metadatos ni midiendo la pista de vídeo.');
  }
  const sourceStart=Math.max(0,Number(clip.sourceStart??clip.start)||0);
  const clipDuration=Number(clip.end)-Number(clip.start);
  if(clipDuration<=0||sourceStart>=sourceDuration||sourceStart+clipDuration>sourceDuration+.05){
    input.dispose();
    throw new Error(`El corte ${index+1} (${sourceStart.toFixed(2)}–${(sourceStart+clipDuration).toFixed(2)} s) queda fuera de la duración real del vídeo (${sourceDuration.toFixed(2)} s).`);
  }
  const output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()});
  const cues=buildCaptionCues(segments);
  const imageBitmaps=new Map();
  const imageItems=(tracks||[]).filter(t=>t.type==="image"&&!t.hidden).flatMap(t=>t.items||[]).filter(x=>x.assetId);
  try{
    for(const item of imageItems){
      if(imageBitmaps.has(item.assetId))continue;
      const blob=await window.ClipForgeStudio?.getAssetBlob?.(item.assetId);
      if(!blob)throw new Error("No se encuentra la imagen "+(item.assetName||item.assetId)+".");
      imageBitmaps.set(item.assetId,await createImageBitmap(blob));
    }
  }catch(error){for(const bitmap of imageBitmaps.values())bitmap.close?.();input.dispose();throw error;}
  let canvas=null,ctx=null,sourceCanvas=null,sourceCtx=null,faceLandmarker=null,poseLandmarker=null;
  let lastFaceCenter=null,frameNumber=0,faceSamples=0,poseSamples=0,trackingMode='sin seguimiento';
  const speakerTracks=[];
  let activeSpeakerTrack=null;
  const sourceWidth=Number(sourceTrack?.displayWidth||sourceTrack?.width||1920);
  const sourceHeight=Number(sourceTrack?.displayHeight||sourceTrack?.height||1080);
  const portraitCropWidth=sourceHeight*9/16;
  const trackingPossible=settings.cropMode!=='center'&&settings.cropMode!=='blur'&&sourceWidth>portraitCropWidth*1.05;
  if(trackingPossible){
    try{
      sayExport(`Clip ${index+1}/${total}: cargando detector facial gratuito…`);
      const vision=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs');
      const fileset=await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm');
      faceLandmarker=await vision.FaceLandmarker.createFromOptions(fileset,{
        baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'},
        runningMode:'VIDEO',numFaces:5,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false
      });
      // A distant face can be too small to detect in a wide studio shot.
      // Fall back to a free pose model so the crop still follows the person.
      poseLandmarker=await vision.PoseLandmarker.createFromOptions(fileset,{
        baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'},
        runningMode:'VIDEO',numPoses:4
      });
      trackingMode='seguimiento facial con respaldo corporal';
    }catch(error){console.warn('Face/mouth tracking unavailable; using safe blurred background:',error);faceLandmarker=null;}
  }
  const conversion=await Conversion.init({
    input,output,tracks:'primary',audio:{discard:true},composable:true,
    trim:{start:sourceStart,end:sourceStart+clipDuration},
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
        const fx=clip.visualEffects||{};
        const filterPresets={cinematic:'contrast(1.14) saturate(.82)',warm:'sepia(.16) saturate(1.2)',cool:'hue-rotate(12deg) saturate(.9)',bw:'grayscale(1) contrast(1.08)',vintage:'sepia(.32) contrast(.92) saturate(.78)',vivid:'saturate(1.45) contrast(1.08)'};
        const filterParts=[filterPresets[fx.preset]||'',fx.brightness&&fx.brightness!==100?'brightness('+fx.brightness+'%)':'',fx.contrast&&fx.contrast!==100?'contrast('+fx.contrast+'%)':'',fx.saturation&&fx.saturation!==100?'saturate('+fx.saturation+'%)':''].filter(Boolean);
        const transition=clip.transitions||{},duration=Math.max(.1,Math.min(2,Number(transition.duration)||.5));
        const fadeIn=transition.in==='fade'?Math.min(1,Math.max(0,stamp/duration)):1;
        const fadeOut=transition.out==='fade'?Math.min(1,Math.max(0,(clipDuration-stamp)/duration)):1;
        const zoomIn=transition.in==='zoom'?1+Math.max(0,1-stamp/duration)*.12:1;
        const zoomOut=transition.out==='zoom'?1+Math.max(0,1-(clipDuration-stamp)/duration)*.12:1;
        ctx.save();ctx.filter=filterParts.join(' ')||'none';ctx.globalAlpha=Math.min(fadeIn,fadeOut,Math.max(0,Math.min(1,Number(clip.opacity??100)/100)));
        const zoom=Math.max(zoomIn,zoomOut);ctx.translate(540,960);ctx.scale(zoom,zoom);ctx.translate(-540,-960);
        if(sourceCanvas){
          sourceCtx.clearRect(0,0,sourceCanvas.width,sourceCanvas.height);
          sample.drawWithFit(sourceCtx,{fit:'contain'});
        }
        if(faceLandmarker&&sourceCanvas){
          frameNumber++;
          if(frameNumber%6===1){
            const result=faceLandmarker.detectForVideo(sourceCanvas,Math.max(0,Math.round(stamp*1000)));
            const faces=result?.faceLandmarks||[];
            const seen=[];
            for(const landmarks of faces){
              if(!landmarks?.length)continue;
              const xs=landmarks.map(p=>Number(p.x)).filter(Number.isFinite);
              const ys=landmarks.map(p=>Number(p.y)).filter(Number.isFinite);
              if(!xs.length||!ys.length)continue;
              const minX=Math.min(...xs),maxX=Math.max(...xs),faceHeight=Math.max(.001,Math.max(...ys)-Math.min(...ys));
              const faceWidth=maxX-minX;
              // Ignore tiny faces on posters/screens and background artwork;
              // otherwise the crop can lock onto a picture instead of a person.
              if(faceHeight<.085||faceWidth<.04)continue;
              const center=(minX+maxX)/2;
              const upper=landmarks[13],lower=landmarks[14];
              const mouthOpen=upper&&lower?Math.abs(Number(lower.y)-Number(upper.y))/faceHeight:0;
              let track=speakerTracks.filter(t=>!seen.includes(t)).sort((x,y)=>Math.abs(x.center-center)-Math.abs(y.center-center))[0];
              if(!track||Math.abs(track.center-center)>.16){track={center,previousMouth:mouthOpen,activity:0,samples:0,faceArea:faceHeight*faceWidth};speakerTracks.push(track);}
              const motion=Math.abs(mouthOpen-track.previousMouth);
              track.activity=track.activity*.72+Math.min(1,motion*7+mouthOpen*.12)*.28;
              track.center=track.center*.65+center*.35;
              track.faceArea=faceHeight*faceWidth;
              track.previousMouth=mouthOpen;track.samples++;track.lastSeen=frameNumber;
              seen.push(track);
            }
            if(seen.length)faceSamples++;
            for(let i=speakerTracks.length-1;i>=0;i--)if(frameNumber-speakerTracks[i].lastSeen>45)speakerTracks.splice(i,1);
            if(seen.length){
              // In group shots, keep the largest visible face centered rather
              // than disabling tracking altogether. This is visual subject
              // tracking, not speaker diarization.
              const primary=[...seen].sort((a,b)=>(b.faceArea||0)-(a.faceArea||0))[0];
              activeSpeakerTrack=primary;
              const desired=primary.center*sourceWidth;
              lastFaceCenter=lastFaceCenter===null?desired:lastFaceCenter*.78+desired*.22;
            }else if(poseLandmarker){
              const poseResult=poseLandmarker.detectForVideo(sourceCanvas,Math.max(0,Math.round(stamp*1000)));
              const poses=poseResult?.landmarks||[];
              const candidates=poses.map(points=>{
                const nose=points[0],left=points[11],right=points[12];
                const valid= nose&&left&&right&&nose.visibility>.5&&left.visibility>.5&&right.visibility>.5;
                const center=valid?(left.x+right.x)/2:NaN;
                const visibility=valid?left.visibility+right.visibility+nose.visibility:0;
                return {center,visibility};
              }).filter(x=>Number.isFinite(x.center)).sort((a,b)=>b.visibility-a.visibility);
              if(candidates.length){
                const desired=candidates[0].center*sourceWidth;
                lastFaceCenter=lastFaceCenter===null?desired:lastFaceCenter*.72+desired*.28;
                poseSamples++;
              }else if(frameNumber-(Math.max(0,...speakerTracks.map(t=>t.lastSeen)))>18){
                lastFaceCenter=null;activeSpeakerTrack=null;
              }
            }else if(!faces.length&&frameNumber-(Math.max(0,...speakerTracks.map(t=>t.lastSeen)))>18){
              lastFaceCenter=null;activeSpeakerTrack=null;
            }
          }
        }
        if(settings.cropMode==='center'&&sourceCanvas){
          const cropWidth=Math.min(sourceCanvas.width,sourceCanvas.height*9/16);
          const left=Math.max(0,(sourceCanvas.width-cropWidth)/2);
          ctx.drawImage(sourceCanvas,left,0,cropWidth,sourceCanvas.height,0,0,1080,1920);
        }else if(faceLandmarker&&sourceCanvas&&lastFaceCenter!==null){
          const cropWidth=Math.min(sourceCanvas.width,sourceCanvas.height*9/16);
          const center=lastFaceCenter*sourceCanvas.width/sourceWidth;
          // Keep the speaker centered even at the extreme left/right edge.
          // Fill any out-of-frame area with a blurred copy instead of clamping
          // the crop and cutting half of the speaker's face.
          const left=center-cropWidth/2,scale=1080/cropWidth;
          ctx.save();ctx.filter='blur(24px)';sample.drawWithFit(ctx,{fit:'cover'});ctx.restore();
          ctx.drawImage(sourceCanvas,-left*scale,0,sourceCanvas.width*scale,1920);
        }else{
          // When dialogue has multiple faces or tracking is unavailable, retain
          // the complete shot over a blurred fill instead of cutting a speaker off.
          ctx.save();ctx.filter='blur(24px)';sample.drawWithFit(ctx,{fit:'cover'});ctx.restore();
          sample.drawWithFit(ctx,{fit:'contain'});
        }
        ctx.restore();
        // Mediabunny normalizes timestamps to zero after trim; captions keep source-video times.
        const sourceTime=sourceStart+stamp;
        const timelineTime=clip.start+stamp;
        drawImageLayers(ctx,tracks,timelineTime,canvas.width,canvas.height,imageBitmaps);
        drawTextLayers(ctx,tracks,timelineTime,canvas.width,canvas.height);
        drawKaraokeCaption(ctx,cues,timelineTime,canvas.width,canvas.height,settings);
        return canvas;
      },
      processedWidth:1080,processedHeight:1920
    },
  });
  if(!conversion.isValid){
    const reasons=(conversion.discardedTracks||[]).map(x=>x.reason).join(', ');
    throw new Error(`El navegador no puede codificar todas las pistas MP4 de este vídeo (${reasons||'códec no compatible'}).`);
  }
  conversion.onProgress=p=>sayExport(`Clip ${index+1}/${total}: renderizando vídeo ${Math.round(p*100)}%…`);
  const mixedAudio=await buildMixedAudioBuffer(file,clip,tracks);
  const audioQuality=new Quality({bitrate:128e3});
  if(!(await canEncodeAudio("aac",{numberOfChannels:2,sampleRate:48000,quality:audioQuality}))){
    const {registerAacEncoder}=await import("https://esm.sh/@mediabunny/aac-encoder@1.65.2?external=mediabunny");
    registerAacEncoder();
  }
  const audioSource=new AudioBufferSource({codec:"aac",quality:audioQuality});
  output.addAudioTrack(audioSource,{name:"Mezcla ClipForge",languageCode:"spa"});
  try{
    await output.start();
    const results=await Promise.allSettled([
      conversion.execute(),
      audioSource.add(mixedAudio).then(()=>audioSource.close())
    ]);
    const failure=results.find(x=>x.status==="rejected");
    if(failure)throw failure.reason;
    await output.finalize();
  }catch(error){await output.cancel().catch(()=>{});throw error;}
  finally{audioSource.close();faceLandmarker?.close?.();poseLandmarker?.close?.();input.dispose();for(const bitmap of imageBitmaps.values())bitmap.close?.();}
  const buffer=output.target.buffer;
  if(!buffer||buffer.byteLength<1024)throw new Error('El render terminó sin generar un MP4 válido.');
  const blob=new Blob([buffer],{type:'video/mp4'});
  const verifiedTrackingMode=faceSamples>0?'seguimiento facial':poseSamples>0?'seguimiento corporal de respaldo':'encuadre vertical seguro sin detección de persona';
  return {blob,bytes:blob.size,duration:clipDuration,trackingMode:verifiedTrackingMode,faceSamples,poseSamples,name:`clipforge-${String(index+1).padStart(2,'0')}.mp4`};
}

exportButton?.addEventListener('click',async()=>{
  const file=document.querySelector('#video')?.files?.[0];
  const bridge=window.clipforgeEditorBridge?.getProject?.()||{};
  const studio=window.ClipForgeStudio?.getProject?.();
  const project=studio?.clips?.length?studio:bridge;
  const tracks=project?.tracks||[];
  const hasVideoTracks=tracks.some(t=>t.type==="video");
  const videoTracks=tracks.filter(t=>t.type==="video"&&!t.hidden);
  const timelineClips=videoTracks.flatMap(t=>t.items||[]);
  const clipSource=hasVideoTracks?timelineClips:(project?.clips||[]);
  const clips=clipSource.filter(c=>c.selected!==false&&!c.hidden&&Number.isFinite(Number(c.start))&&Number.isFinite(Number(c.end))&&Number(c.end)>Number(c.start)).sort((a,b)=>Number(a.start)-Number(b.start));
  const hasSubtitleTrack=tracks.some(t=>t.type==='subtitles');
  const subtitleTrack=tracks.find(t=>t.type==='subtitles'&&!t.hidden);
  const segments=hasSubtitleTrack?(subtitleTrack?.items||[]):(project?.transcript?.segments||[]);
  if(!file){sayExport('Selecciona el MP4 original antes de exportar.');return;}
  if(!clips.length){sayExport('No hay clips seleccionados para exportar. Marca al menos uno en la lista de momentos.');return;}
  const expected=String(project?.source?.name||project?.source||'').split(/[\\/]/).pop();
  if(expected&&expected!==file.name){sayExport('El proyecto corresponde a '+expected+'; selecciona el vídeo original para evitar exportar otro archivo.');return;}
  if(!('VideoEncoder'in window)||!('OffscreenCanvas'in window)){sayExport('Este navegador no ofrece WebCodecs/OffscreenCanvas. Usa Chrome o Edge actualizado.');return;}
  exportButton.disabled=true;
  const results=[];
  const settings={
    captionPosition:document.querySelector('#captionPosition')?.value||'bottom',
    captionColor:document.querySelector('#captionColor')?.value||'yellow',
    captionBackground:document.querySelector('#captionBackground')?.value||'dark',
    captionSize:document.querySelector('#captionSize')?.value||'5.2',
    cropMode:document.querySelector('#browserCropMode')?.value||'face'
  };
  try{
    for(let i=0;i<clips.length;i++){
      const clip={...clips[i],start:Number(clips[i].start),end:Number(clips[i].end),sourceStart:Number(clips[i].sourceStart??clips[i].start)};
      if(clip.end-clip.start>36000)throw new Error('Un corte supera el límite de seguridad de 10 horas.');
      results.push(await exportOne(file,clip,segments,tracks,i,clips.length,{...settings,subtitleStyle:clips[i].subtitleStyle||null}));
    }
    if(results.length===1){
      const url=URL.createObjectURL(results[0].blob),a=document.createElement('a');
      a.href=url;a.download=results[0].name;document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      sayExport('Exportación terminada: 1 MP4 · 1080×1920 · H.264 + AAC mezclado · vídeo, música, efectos, subtítulos y capas de texto renderizados.');
      return;
    }
    sayExport('Preparando paquete ZIP con los MP4…');
    const JSZip=(await import('https://esm.sh/jszip@3.10.1')).default;
    const zip=new JSZip();results.forEach(item=>zip.file(item.name,item.blob));
    const archive=await zip.generateAsync({type:'blob',compression:'STORE'});
    const url=URL.createObjectURL(archive),a=document.createElement('a');
    a.href=url;a.download='clipforge-exportacion-mp4.zip';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    sayExport('Exportación terminada: '+results.length+' MP4 en ZIP · H.264 + AAC mezclado · vídeo, música, efectos, subtítulos y capas de texto.');
  }catch(error){console.error(error);sayExport('Exportación detenida: '+error.message+'. Comprueba el archivo de audio original y las pistas importadas; no se ha enviado el vídeo a ningún servidor.');}
  finally{exportButton.disabled=false;}
});

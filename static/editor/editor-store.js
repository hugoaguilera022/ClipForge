const clone = value => value == null ? value : (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const TRACK_TYPES = ['video','audio','subtitles','text','effects'];

function normalizeTrack(track, index = 0) {
  const type = TRACK_TYPES.includes(track?.type) ? track.type : 'video';
  return {
    id: String(track?.id || uid('track')),
    type,
    name: String(track?.name || `Pista ${index + 1}`),
    muted: Boolean(track?.muted),
    volume: Math.max(0, Math.min(2, Number(track?.volume ?? 1))),
    hidden: Boolean(track?.hidden),
    locked: Boolean(track?.locked),
    items: (Array.isArray(track?.items) ? track.items : []).map((item, itemIndex) => normalizeItem(item, itemIndex))
  };
}
function normalizeItem(item, index = 0) {
  const start = Math.max(0, Number(item?.start) || 0);
  const end = Math.max(start, Number(item?.end) || start);
  return {
    ...clone(item || {}),
    id: String(item?.id || uid('item')),
    start, end,
    name: String(item?.name || item?.title || item?.text || `Elemento ${index + 1}`)
  };
}
function makeTracks(clips, transcript) {
  const validClips=(clips||[]).filter(c=>Number(c.end)>Number(c.start)).map((clip,i)=>({...clip,id:String(clip.id||uid('clip-'+(i+1)))}));
  const cues=(transcript?.segments||[]).filter(s=>Number(s.end)>Number(s.start));
  return [
    normalizeTrack({id:'track-v1',type:'video',name:'V1 · Vídeo principal',items:validClips.map(c=>({...c,sourceStart:Number.isFinite(Number(c.sourceStart))?Number(c.sourceStart):Number(c.start),name:c.title||c.text||'Clip'}))},0),
    normalizeTrack({id:'track-a1',type:'audio',name:'A1 · Audio original',items:validClips.map(c=>({id:`audio-source-${c.id}`,clipId:c.id,name:'Audio original',start:Number(c.start),end:Number(c.end),sourceType:'primary',sourceStart:Number.isFinite(Number(c.sourceStart))?Number(c.sourceStart):Number(c.start),gain:0.8}))},1),
    normalizeTrack({id:'track-a2',type:'audio',name:'A2 · Música',items:[]},2),
    normalizeTrack({id:'track-a3',type:'audio',name:'A3 · Efectos sonoros',items:[]},3),
    normalizeTrack({id:'track-s1',type:'subtitles',name:'S1 · Subtítulos',items:cues.map((s,i)=>({id:`subtitle-${i+1}`,start:s.start,end:s.end,text:s.text,words:s.words||[]}))},4),
    normalizeTrack({id:'track-t1',type:'text',name:'T1 · Textos y títulos',items:[]},5),
    normalizeTrack({id:'track-fx',type:'effects',name:'FX · Efectos',items:[]},6)
  ];
}

export class EditorStore extends EventTarget {
  constructor() {
    super();
    this.project = {
      schema:'clipforge-project-v3', id:uid('project'), name:'Proyecto sin título',
      source:'', media:[], clips:[], transcript:null, tracks:[],
      settings:{width:1080,height:1920,fps:30,format:'9:16'},
      selection:[], playhead:0, duration:0, updatedAt:Date.now()
    };
    this.undoStack=[]; this.redoStack=[]; this.limit=100; this.revision=0;
    this.saveTimer=null; this.dbPromise=null; this.ready=false;
  }
  snapshot(){ return clone(this.project); }
  emit(reason='update') {
    this.project.updatedAt=Date.now(); this.revision++;
    this.dispatchEvent(new CustomEvent('change',{detail:{project:this.snapshot(),reason,revision:this.revision}}));
    this.dispatchEvent(new CustomEvent('clipforge:project-changed',{detail:{project:this.snapshot(),reason,revision:this.revision}}));
    if(reason!=='hydrate')this.scheduleSave();
  }
  commit(reason, mutator) {
    this.undoStack.push(this.snapshot());
    if(this.undoStack.length>this.limit)this.undoStack.shift();
    this.redoStack.length=0;
    mutator(this.project);
    this.project.tracks=(this.project.tracks||[]).map(normalizeTrack);
    const videoTrack=this.project.tracks.find(t=>t.type==='video');
    if(videoTrack){
      this.project.clips=videoTrack.items.map(item=>({...item,start:item.start,end:item.end,selected:true}));
      const sourceAudioTrack=this.project.tracks.find(t=>t.type==='audio'&&(t.id==='track-a1'||t.items.some(item=>item.sourceType==='primary')));
      if(sourceAudioTrack&&!sourceAudioTrack.locked){
        const clips=videoTrack.items,clipIds=new Set(clips.map(item=>String(item.id)));
        const previous=sourceAudioTrack.items.filter(item=>item.sourceType==='primary');
        sourceAudioTrack.items=sourceAudioTrack.items.filter(item=>item.sourceType!=='primary');
        for(const clip of clips){
          const prior=previous.find(item=>String(item.clipId||item.id)===String(clip.id));
          sourceAudioTrack.items.push({
            ...(prior||{}),
            id:prior?.id||`audio-source-${clip.id}`,
            clipId:String(clip.id),
            sourceType:'primary',
            name:prior?.name||'Audio original',
            start:clip.start,
            end:clip.end,
            sourceStart:prior&&Number.isFinite(Number(prior.sourceStart))
              ? Number(prior.sourceStart)+(reason==='item:move'?0:(Number(clip.start)-Number(prior.start)))
              : (Number.isFinite(Number(clip.sourceStart))?Number(clip.sourceStart):clip.start),
            gain:prior?.gain??0.8
          });
        }
      }
    }
    const subtitleTrack=this.project.tracks.find(t=>t.type==='subtitles');
    if(subtitleTrack&&this.project.transcript){
      this.project.transcript={...this.project.transcript,segments:subtitleTrack.items.map(item=>({start:item.start,end:item.end,text:String(item.text||''),words:Array.isArray(item.words)?item.words:[]}))};
    }
    this.project.duration=Math.max(0,...this.project.tracks.flatMap(t=>t.items.map(i=>i.end)));
    this.emit(reason);
    return this.snapshot();
  }
  hydrate(data={}) {
    this.undoStack.length=0;this.redoStack.length=0;
    const p=clone(data)||{};
    const clips=Array.isArray(p.clips)?p.clips:[];
    const transcript=p.transcript&&Array.isArray(p.transcript.segments)?p.transcript:null;
    const tracks=Array.isArray(p.tracks)&&p.tracks.length?p.tracks.map(normalizeTrack):makeTracks(clips,transcript);
    // Upgrade older saved projects that had only the video/subtitle/text lanes.
    if(!tracks.some(t=>t.type==='audio'&&t.id==='track-a1'))tracks.push(normalizeTrack({id:'track-a1',type:'audio',name:'A1 · Audio original',items:[]},tracks.length));
    if(!tracks.some(t=>t.type==='audio'&&t.id==='track-a2'))tracks.push(normalizeTrack({id:'track-a2',type:'audio',name:'A2 · Música',items:[]},tracks.length));
    if(!tracks.some(t=>t.type==='audio'&&t.id==='track-a3'))tracks.push(normalizeTrack({id:'track-a3',type:'audio',name:'A3 · Efectos sonoros',items:[]},tracks.length));
    const videoTrack=tracks.find(t=>t.type==='video');
    if(videoTrack)videoTrack.items=videoTrack.items.map(item=>({...item,sourceStart:Number.isFinite(Number(item.sourceStart))?Number(item.sourceStart):Number(item.start)}));
    const sourceAudioTrack=tracks.find(t=>t.id==='track-a1');
    if(sourceAudioTrack&&!sourceAudioTrack.locked&&!sourceAudioTrack.items.some(item=>item.sourceType==='primary')){
      sourceAudioTrack.items=(tracks.find(t=>t.type==='video')?.items||clips).map((clip,i)=>({
        id:`audio-source-${clip.id||i+1}`,clipId:String(clip.id||''),sourceType:'primary',
        name:'Audio original',start:Number(clip.start)||0,end:Number(clip.end)||0,
        sourceStart:Number.isFinite(Number(clip.sourceStart))?Number(clip.sourceStart):Number(clip.start)||0,gain:0.8
      })).filter(item=>item.end>item.start);
    }
    if(!tracks.some(t=>t.type==='text'))tracks.push(normalizeTrack({id:'track-t1',type:'text',name:'T1 · Textos y títulos',items:[]},tracks.length));
    if(!tracks.some(t=>t.type==='subtitles')&&transcript)tracks.push(normalizeTrack({id:'track-s1',type:'subtitles',name:'S1 · Subtítulos',items:transcript.segments},tracks.length));
    if(!tracks.some(t=>t.type==='effects'))tracks.push(normalizeTrack({id:'track-fx',type:'effects',name:'FX · Efectos',items:[]},tracks.length));
    this.project={
      ...this.project,...p,schema:'clipforge-project-v3',
      id:String(p.id||this.project.id),source:String(p.source||''),
      clips,transcript,tracks,
      media:Array.isArray(p.media)?p.media:[],
      settings:{...this.project.settings,...(p.settings||{})},
      selection:Array.isArray(p.selection)?p.selection:[],
      playhead:Math.max(0,Number(p.playhead)||0),
      duration:Math.max(0,...tracks.flatMap(t=>t.items.map(i=>i.end)))
    };
    this.ready=true; this.emit('hydrate'); return this.snapshot();
  }
  async openDB() {
    if(this.dbPromise)return this.dbPromise;
    this.dbPromise=new Promise((resolve,reject)=>{
      if(!('indexedDB' in globalThis)){reject(new Error('IndexedDB no disponible'));return;}
      const req=indexedDB.open('clipforge-editor-v3',1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('projects'))req.result.createObjectStore('projects',{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    return this.dbPromise;
  }
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer=setTimeout(()=>this.save().catch(error=>this.dispatchEvent(new CustomEvent('storage-error',{detail:error}))),500);
  }
  async save() {
    const db=await this.openDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('projects','readwrite');
      tx.objectStore('projects').put(this.snapshot());
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('No se pudo guardar el proyecto'));
    });
    try{localStorage.setItem('clipforge.editor.lastProject',this.project.id);}catch{}
    return this.project.id;
  }
  async recoverLast() {
    try{
      const id=localStorage.getItem('clipforge.editor.lastProject');if(!id)return null;
      const db=await this.openDB();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('projects','readonly'),req=tx.objectStore('projects').get(id);
        req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
      });
    }catch(error){this.dispatchEvent(new CustomEvent('storage-error',{detail:error}));return null;}
  }
  undo() {
    if(!this.undoStack.length)return false;
    this.redoStack.push(this.snapshot());this.project=this.undoStack.pop();this.emit('undo');return true;
  }
  redo() {
    if(!this.redoStack.length)return false;
    this.undoStack.push(this.snapshot());this.project=this.redoStack.pop();this.emit('redo');return true;
  }
  select(ids){this.project.selection=[...new Set((Array.isArray(ids)?ids:[ids]).filter(Boolean).map(String))];this.emit('selection');}
  setPlayhead(seconds){this.project.playhead=Math.max(0,Math.min(this.project.duration,Number(seconds)||0));this.emit('playhead');}
}
export { normalizeTrack, normalizeItem, makeTracks, uid };

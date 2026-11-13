import { normalizeTrack, normalizeItem, uid } from './editor-store.js';

export class EditorCommands {
  constructor(store){this.store=store;this.clipboard=[];}
  track(id){return this.store.project.tracks.find(t=>t.id===id);}
  item(id){for(const track of this.store.project.tracks){const item=track.items.find(x=>x.id===id);if(item)return {track,item};}return null;}
  addTrack(type='video',name) {
    if(!['video','audio','subtitles','text','effects'].includes(type))throw new Error('Tipo de pista no válido');
    const track=normalizeTrack({id:uid('track'),type,name:name||({video:'Vídeo',audio:'Audio',subtitles:'Subtítulos',text:'Textos',effects:'Efectos'}[type]),items:[]},this.store.project.tracks.length);
    this.store.commit('track:add',p=>p.tracks.push(track));return track.id;
  }
  addItem(trackId,data={}) {
    const track=this.track(trackId);if(!track)throw new Error('La pista no existe');
    if(track.locked)throw new Error('La pista está bloqueada');
    const item=normalizeItem({...data,id:data.id||uid('item')},track.items.length);
    if(item.end<=item.start)throw new Error('La duración del elemento debe ser mayor que cero');
    this.store.commit('item:add',p=>p.tracks.find(t=>t.id===trackId).items.push(item));return item.id;
  }
  updateItem(id,patch={}) {
    const found=this.item(id);if(!found)throw new Error('Elemento no encontrado');
    if(found.track.locked)throw new Error('La pista está bloqueada');
    this.store.commit('item:update',p=>{
      const t=p.tracks.find(x=>x.id===found.track.id),i=t.items.find(x=>x.id===id);
      Object.assign(i,patch);
      if('start'in patch)i.start=Math.max(0,Number(patch.start)||0);
      if('end'in patch)i.end=Math.max(i.start,Number(patch.end)||i.start);
      if(i.end<=i.start)throw new Error('Intervalo no válido');
    });
  }
  moveItem(id,start,trackId) {
    const found=this.item(id);if(!found)throw new Error('Elemento no encontrado');
    const target=this.track(trackId||found.track.id);if(!target)throw new Error('Pista de destino no encontrada');
    if(found.track.locked||target.locked)throw new Error('Desbloquea la pista para mover elementos');
    const next=Math.max(0,Number(start)||0),duration=found.item.end-found.item.start;
    this.store.commit('item:move',p=>{
      const from=p.tracks.find(t=>t.id===found.track.id),to=p.tracks.find(t=>t.id===target.id);
      const index=from.items.findIndex(x=>x.id===id),[item]=from.items.splice(index,1);
      item.start=next;item.end=next+duration;to.items.push(item);
    });
  }
  trimItem(id,start,end) {
    const found=this.item(id);if(!found)throw new Error('Elemento no encontrado');
    this.updateItem(id,{start:Math.max(0,Number(start)||0),end:Number(end)});
  }
  splitItem(id,at=this.store.project.playhead) {
    const found=this.item(id);if(!found)throw new Error('Elemento no encontrado');
    const t=Number(at);if(!Number.isFinite(t)||t<=found.item.start||t>=found.item.end)throw new Error('El cabezal debe estar dentro del elemento');
    if(found.track.locked)throw new Error('La pista está bloqueada');
    let rightId='';
    this.store.commit('item:split',p=>{
      const track=p.tracks.find(x=>x.id===found.track.id),left=track.items.find(x=>x.id===id);
      const right={...left,id:uid('item'),start:t,end:left.end};
      left.end=t;
      if(Number.isFinite(Number(left.sourceStart)))right.sourceStart=Number(left.sourceStart)+(t-Number(left.start));
      track.items.splice(track.items.findIndex(x=>x.id===id)+1,0,right);rightId=right.id;
    });
    return rightId;
  }
  remove(ids) {
    const set=new Set((Array.isArray(ids)?ids:[ids]).map(String));
    this.store.commit('item:delete',p=>p.tracks.forEach(t=>{if(!t.locked)t.items=t.items.filter(i=>!set.has(i.id));}));
  }
  duplicate(id,offset=0.25) {
    const found=this.item(id);if(!found)throw new Error('Elemento no encontrado');
    if(found.track.locked)throw new Error('La pista está bloqueada');
    const copy={...found.item,id:uid('item'),start:found.item.start+Math.max(0,Number(offset)||0),end:found.item.end+Math.max(0,Number(offset)||0)};
    this.store.commit('item:duplicate',p=>p.tracks.find(t=>t.id===found.track.id).items.push(copy));return copy.id;
  }
  copy(ids) {
    const wanted=new Set((Array.isArray(ids)?ids:[ids]).map(String));
    this.clipboard=this.store.project.tracks.flatMap(t=>t.items.filter(i=>wanted.has(i.id)).map(i=>({...i,trackType:t.type,trackId:t.id})));
    return this.clipboard.length;
  }
  paste(at=this.store.project.playhead) {
    if(!this.clipboard.length)return [];
    const created=[];
    this.store.commit('item:paste',p=>{
      for(const source of this.clipboard){
        let track=p.tracks.find(t=>t.id===source.trackId&&!t.locked);
        if(!track)track=p.tracks.find(t=>t.type===source.trackType&&!t.locked);
        if(!track)continue;
        const start=Math.max(0,Number(at)||0),duration=source.end-source.start;
        const item={...source,id:uid('item'),start,end:start+duration};delete item.trackType;delete item.trackId;
        track.items.push(item);created.push(item.id);
      }
    });return created;
  }
  setTrackState(id,patch) {
    const track=this.track(id);if(!track)throw new Error('Pista no encontrada');
    this.store.commit('track:update',p=>Object.assign(p.tracks.find(t=>t.id===id),patch));
  }
  setSetting(key,value) {
    const allowed=['width','height','fps','format'];if(!allowed.includes(key))throw new Error('Ajuste no permitido');
    this.store.commit('settings:update',p=>{p.settings[key]=value;});
  }
}

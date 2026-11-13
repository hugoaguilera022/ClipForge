import assert from 'node:assert/strict';
import { EditorStore } from '../static/editor/editor-store.js';
import { EditorCommands } from '../static/editor/editor-commands.js';

const store=new EditorStore();
const commands=new EditorCommands(store);
store.hydrate({
  source:'la-resistencia-test.mp4',
  clips:[{id:'clip-1',start:10,end:20,title:'Prueba'}],
  transcript:{segments:[{start:10,end:12,text:'Hola mundo',words:[]}]}
});
assert.equal(store.project.tracks.filter(t=>t.type==='video').length,1);
assert.equal(store.project.tracks.filter(t=>t.type==='subtitles').length,1);

const video=store.project.tracks.find(t=>t.type==='video');
const right=commands.splitItem('clip-1',15);
assert.equal(store.project.tracks.find(t=>t.type==='video').items[0].end,15);
assert.equal(store.project.tracks.find(t=>t.type==='video').items.find(x=>x.id===right).start,15);
const sourceAudio=store.project.tracks.find(t=>t.id==='track-a1');
assert.equal(sourceAudio.items.find(x=>x.clipId==='clip-1').end,15);
assert.equal(sourceAudio.items.find(x=>x.clipId===right).sourceStart,15);
assert.equal(store.project.clips.length,2);
assert.equal(store.undo(),true);
assert.equal(store.project.clips.length,1);
assert.equal(store.redo(),true);
assert.equal(store.project.clips.length,2);

const audioId=commands.addTrack('audio','Música');
const audioItem=commands.addItem(audioId,{start:0,end:8,name:'Música'});
commands.moveItem(audioItem,2);
assert.equal(commands.item(audioItem).item.start,2);
commands.trimItem(audioItem,3,7);
assert.equal(commands.item(audioItem).item.end,7);
commands.copy(audioItem);
const pasted=commands.paste(9);
assert.equal(pasted.length,1);
assert.equal(commands.item(pasted[0]).item.start,9);
commands.remove(pasted[0]);
assert.equal(commands.item(pasted[0]),null);

const audioFile=new Blob(['mock-audio-data'],{type:'audio/wav'});
const imported=commands.importAudioFile(audioFile,audioId,12,6);
const importedItem=commands.item(imported).item;
assert.equal(importedItem.end,18);
const snapshot=store.snapshot();
assert.equal(snapshot.media[0].blob.size,audioFile.size,'project snapshots must preserve imported audio blobs');
assert.equal(commands.item(imported).item.mediaId,snapshot.media[0].id);

const before=commands.item(audioItem).item.start;
assert.throws(()=>commands.updateItem(audioItem,{start:10,end:9}),/Intervalo/);
assert.equal(commands.item(audioItem).item.start,before,'invalid edits must not mutate the project');

commands.setTrackState(audioId,{locked:true});
assert.throws(()=>commands.addItem(audioId,{start:0,end:1}),/bloqueada/);
clearTimeout(store.saveTimer);
console.log('editor store and command tests passed');

// Same-origin FFmpeg worker for Safari and browsers that reject CDN/blob workers.
const TYPES={LOAD:"LOAD",EXEC:"EXEC",FFPROBE:"FFPROBE",WRITE_FILE:"WRITE_FILE",READ_FILE:"READ_FILE",DELETE_FILE:"DELETE_FILE",ERROR:"ERROR",LOG:"LOG",PROGRESS:"PROGRESS",RENAME:"RENAME",CREATE_DIR:"CREATE_DIR",LIST_DIR:"LIST_DIR",DELETE_DIR:"DELETE_DIR",MOUNT:"MOUNT",UNMOUNT:"UNMOUNT"};
let core=null;
function send(id,type,data){self.postMessage({id,type,data});}
async function load(config){
  const module=await import(config.coreURL);
  const factory=module.default||self.createFFmpegCore;
  if(typeof factory!=="function")throw new Error("No se pudo inicializar el núcleo FFmpeg WASM.");
  const wasmURL=config.wasmURL||config.coreURL.replace(/\.js$/,".wasm");
  const workerURL=config.workerURL||config.coreURL.replace(/\.js$/,".worker.js");
  core=await factory({mainScriptUrlOrBlob:config.coreURL+"#"+btoa(JSON.stringify({wasmURL,workerURL}))});
  core.setLogger(data=>send(undefined,TYPES.LOG,data));
  core.setProgress(data=>send(undefined,TYPES.PROGRESS,data));
  return true;
}
self.onmessage=async({data:{id,type,data}})=>{
 try{
  if(type!==TYPES.LOAD&&!core)throw new Error("FFmpeg no está cargado.");
  let result;
  switch(type){
   case TYPES.LOAD: result=await load(data);break;
   case TYPES.EXEC: core.setTimeout(data.timeout??-1);core.exec(...data.args);result=core.ret;core.reset();break;
   case TYPES.FFPROBE: core.setTimeout(data.timeout??-1);core.ffprobe(...data.args);result=core.ret;core.reset();break;
   case TYPES.WRITE_FILE: core.FS.writeFile(data.path,data.data);result=true;break;
   case TYPES.READ_FILE: result=core.FS.readFile(data.path,{encoding:data.encoding});break;
   case TYPES.DELETE_FILE: core.FS.unlink(data.path);result=true;break;
   case TYPES.RENAME: core.FS.rename(data.oldPath,data.newPath);result=true;break;
   case TYPES.CREATE_DIR: core.FS.mkdir(data.path);result=true;break;
   case TYPES.LIST_DIR: result=core.FS.readdir(data.path).map(name=>{const stat=core.FS.stat(data.path+"/"+name);return{name,isDir:core.FS.isDir(stat.mode)};});break;
   case TYPES.DELETE_DIR: core.FS.rmdir(data.path);result=true;break;
   default: throw new Error("Operación FFmpeg no soportada: "+type);
  }
  const transfer=result instanceof Uint8Array?[result.buffer]:[];
  send(id,type,result,transfer);
 }catch(error){send(id,TYPES.ERROR,String(error?.message||error));}
};
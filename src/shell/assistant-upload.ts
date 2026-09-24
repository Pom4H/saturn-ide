import { Unzip, UnzipInflate } from 'fflate';
import { inspectLanmon } from './importers/lanmon';
import type { MigrationInventory } from '../core/assistant';
const max=8*1024*1024;
export async function inspectUpload(file:File):Promise<MigrationInventory>{
  if(file.size>32*1024*1024)throw new Error('Файл больше 32 МБ. Загрузите конфигурацию без видео, архивов истории и установщика.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const files:{path:string;bytes:number;text?:string}[]=[];let total=0;
  const add=(path:string,data:Uint8Array)=>{
    let text:string|undefined;
    if(/\.(ini|cfg|csv|xml|json|dat)$/i.test(path)&&data.byteLength<256000&&!data.includes(0)){
      try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{text=new TextDecoder('windows-1251').decode(data);}
    }
    files.push({path,bytes:data.byteLength,text});
  };
  if(/\.zip$/i.test(file.name)){
    let count=0;
    const seen=new Set<string>();
    const unzip=new Unzip(entry=>{
      if(++count>1000)throw new Error('В архиве больше 1000 файлов');
      const path=entry.name.replaceAll('\\','/');
      if(path.startsWith('/')||path.includes(':')||path.split('/').some(p=>p==='..')||seen.has(path))throw new Error('Недопустимый или повторяющийся путь в архиве');
      seen.add(path);if(path.endsWith('/'))return;
      if(entry.originalSize!==undefined&&entry.originalSize>max)throw new Error('Распакованный файл больше 8 МБ');
      const chunks:Uint8Array[]=[];let size=0;
      entry.ondata=(error,chunk,final)=>{if(error)throw new Error('Повреждённый или неподдержанный ZIP');total+=chunk.length;size+=chunk.length;if(total>64*1024*1024||size>max){entry.terminate();throw new Error('Слишком большой распакованный архив');}chunks.push(chunk);if(final){const data=new Uint8Array(size);let at=0;for(const c of chunks){data.set(c,at);at+=c.length;}add(path,data);}};
      entry.start();
    });unzip.register(UnzipInflate);
    // Bound inflate input chunks: an archive with forged size headers must not allocate
    // its entire expanded payload before the ondata limits get a chance to stop it.
    for(let offset=0;offset<bytes.length;offset+=4096)unzip.push(bytes.subarray(offset,offset+4096),offset+4096>=bytes.length);
  }else add(file.name,bytes);
  if(!files.length)throw new Error('Архив не содержит файлов');
  return inspectLanmon(file.name,sha256,files);
}

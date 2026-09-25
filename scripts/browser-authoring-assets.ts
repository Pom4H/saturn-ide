import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import ts from 'typescript';
/** Produce public compiler assets from this exact revision. No project source or runtime credentials are embedded. */
export async function browserAuthoringAssets(output: string, appRoot = resolve(import.meta.dir, '..')) {
  mkdirSync(output,{recursive:true});
  const result=await Bun.build({entrypoints:[join(appRoot,'src/host/browser-workspace.worker.ts')],outdir:output,naming:'authoring-worker.js',target:'browser',format:'iife',minify:true,plugins:[{name:'no-node',setup(build){
    build.onResolve({filter:/^(node:|fs$|path$|os$|perf_hooks$|inspector$|buffer$|crypto$|source-map-support$)/},args=>({path:args.path,namespace:'no-node'}));
    build.onLoad({filter:/./,namespace:'no-node'},()=>({contents:'module.exports = {};',loader:'js'}));
  }}]});
  if(!result.success)throw new Error(result.logs.map(log=>log.message).join('\n'));
  const library:Record<string,string>={},lib=dirname(ts.getDefaultLibFilePath({}));
  for(const name of readdirSync(lib))if(/^lib\..*\.d\.ts$/.test(name))library['/typescript/'+name]=readFileSync(join(lib,name),'utf8');
  const walk=(directory:string,prefix:string)=>{for(const item of readdirSync(directory,{withFileTypes:true})){if(item.isDirectory())walk(join(directory,item.name),prefix+item.name+'/');else if(item.name.endsWith('.ts'))library[prefix+item.name]=readFileSync(join(directory,item.name),'utf8');}};
  walk(join(appRoot,'src/core'),'/saturn/core/');
  library['/saturn/core.ts']=readFileSync(join(appRoot,'src/core.ts'),'utf8');
  writeFileSync(join(output,'authoring-library.json'),JSON.stringify(library));
}
if(import.meta.main)await browserAuthoringAssets(process.argv[2]??'dist');

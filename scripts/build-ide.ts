import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { zipSync } from 'fflate';
const root=resolve(import.meta.dir,'..'),stage=join(root,'.saturn/distribution'),app=join(stage,'app'),out=resolve(Bun.argv[2]??'artifacts/distribution');
rmSync(stage,{recursive:true,force:true});mkdirSync(app,{recursive:true});mkdirSync(out,{recursive:true});
const pkg=await Bun.file(join(root,'package.json')).json();
for(const file of ['src','scripts','docs','package.json','bun.lock'])cpSync(join(root,file),join(app,file),{recursive:true});
const install=Bun.spawn([process.execPath,'install','--production','--frozen-lockfile','--ignore-scripts'],{cwd:app,stdout:'inherit',stderr:'inherit'});if(await install.exited!==0)throw new Error('Production dependency installation failed');
const files:Record<string,Uint8Array>={};
function walk(dir:string){for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.name==='.bin')continue;const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(entry.isFile())files[relative(app,path).replaceAll('\\','/')]=readFileSync(path);}}
walk(app);const payload=zipSync(files,{level:6}),digest=new Bun.CryptoHasher('sha256').update(payload).digest('hex');await Bun.write(join(stage,'payload.zip'),payload);
const entry=join(stage,'entry.ts');await Bun.write(entry,`import payload from './payload.zip' with {type:'file'};\nimport {standalone} from '../../src/host/payload';\nawait standalone(payload,${JSON.stringify(pkg.version)},${JSON.stringify(digest)});`);
const name=`saturn-${process.platform}-${process.arch}${process.platform==='win32'?'.exe':''}`,outfile=join(out,name);
const result=await Bun.build({entrypoints:[entry],target:'bun',compile:{outfile},minify:true});if(!result.success)throw new Error(result.logs.map(l=>l.message).join('\n'));
const binary=await Bun.file(outfile).arrayBuffer(),sha256=new Bun.CryptoHasher('sha256').update(binary).digest('hex');
const receipt={version:pkg.version,platform:process.platform,arch:process.arch,name,sha256,size:binary.byteLength,bun:Bun.version};
await Bun.write(join(out,name+'.json'),JSON.stringify(receipt,null,2)+'\n');await Bun.write(join(out,name+'.sha256'),`${sha256}  ${name}\n`);console.log(JSON.stringify(receipt));

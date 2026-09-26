import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { releaseManifest, type IDEAsset } from '../src/core/distribution';
const dir=resolve(Bun.argv[2]??'artifacts/distribution'),repository=process.env.GITHUB_REPOSITORY??'Pom4H/saturn-ide',revision=process.env.GITHUB_SHA;
if(!revision)throw new Error('GITHUB_SHA is required');
const receipts=await Promise.all(readdirSync(dir).filter(name=>/^saturn-.*\.json$/.test(name)).map(name=>Bun.file(join(dir,name)).json()));
const version=receipts[0]?.version;if(!version||receipts.some(r=>r.version!==version||r.bun!=='1.4.2'))throw new Error('Mixed IDE versions/toolchains');
const expected=['darwin-arm64','darwin-x64','linux-x64','linux-arm64','win32-x64'];if(expected.some(key=>!receipts.some(r=>`${r.platform}-${r.arch}`===key)))throw new Error('Missing platform receipts');
const base=`https://github.com/${repository}/releases/download/ide-v${version}`;
const assets:IDEAsset[]=[];
for(const r of receipts){const file=Bun.file(join(dir,r.name));const actual=new Bun.CryptoHasher('sha256').update(await file.arrayBuffer()).digest('hex');if(actual!==r.sha256||file.size!==r.size)throw new Error('Release asset mismatch: '+r.name);assets.push({platform:r.platform,arch:r.arch,name:r.name,size:r.size,sha256:r.sha256,url:`${base}/${r.name}`});}
const manifest=releaseManifest({version,sourceRevision:revision,publishedAt:new Date().toISOString(),notesUrl:`https://github.com/${repository}/releases/tag/ide-v${version}`,assets});
await Bun.write(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');

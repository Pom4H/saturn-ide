import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const targets={
  'windows-x64':'bun-windows-x64',
  'windows-arm64':'bun-windows-arm64',
  'darwin-x64':'bun-darwin-x64',
  'darwin-arm64':'bun-darwin-arm64',
  'linux-x64':'bun-linux-x64',
  'linux-arm64':'bun-linux-arm64',
} as const;
type Target=keyof typeof targets;
const [targetArg='windows-x64',outputArg='dist/standalone',projectArg]=Bun.argv.slice(2);
if(!(targetArg in targets))throw new Error(`Unknown standalone target: ${targetArg}`);
const target=targetArg as Target,output=resolve(outputArg),root=resolve(import.meta.dir,'..');
const project=projectArg?resolve(projectArg):resolve(root,'../saturn-examples/pumping-station');
if(!existsSync(join(project,'project.ts')))throw new Error(`Project not found: ${project}`);
rmSync(output,{recursive:true,force:true});mkdirSync(output,{recursive:true});
const executable=join(output,target.startsWith('windows')?'saturn.exe':'saturn');
const result=await Bun.build({entrypoints:[join(root,'src/host/standalone.ts')],target:'bun',minify:true,compile:{target:targets[target],outfile:executable}});
if(!result.success)throw new Error(result.logs.map(log=>log.message).join('\n'));

cpSync(join(root,'src'),join(output,'src'),{recursive:true});
const modules=join(root,'node_modules'),normalizedModules=modules.replaceAll('\\','/');
cpSync(modules,join(output,'node_modules'),{recursive:true,filter:path=>{
  const normalized=path.replaceAll('\\','/');
  return normalized!==normalizedModules+'/@saturn/core'&&!normalized.startsWith(normalizedModules+'/@saturn/core/');
}});
for(const name of ['package.json','bun.lock'])cpSync(join(root,name),join(output,name));
const projects=join(output,'projects');mkdirSync(projects,{recursive:true});
const projectOut=join(projects,basename(project));cpSync(project,projectOut,{recursive:true,filter:path=>!path.split(/[\\/]/).some(part=>part==='.git'||part==='node_modules'||part==='.saturn')});
writeFileSync(join(output,'README.txt'),[
  'Saturn IDE portable build',
  '',
  'Run: saturn.exe',
  'Open another project: saturn.exe C:\\path\\to\\project',
  'No Bun/npm/GitHub access is required to start the packaged demo project.',
  'Existing projects may keep their own Git repository and dependencies.',
  ''
].join('\r\n'));
console.log(JSON.stringify({target,executable,project:projectOut,bytes:Bun.file(executable).size}));

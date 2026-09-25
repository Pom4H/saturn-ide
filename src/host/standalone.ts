import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createApp } from './dev';

function valueAfter(name:string,args:string[]){
  const index=args.indexOf(name);
  return index>=0?args[index+1]:undefined;
}
function packagedRoot(exeDir:string){
  const app=join(exeDir,'app');
  return existsSync(join(app,'package.json'))?app:resolve(import.meta.dir,'../..');
}
function defaultProject(exeDir:string){
  const packaged=join(exeDir,'projects','pumping-station');
  return existsSync(join(packaged,'project.ts'))?packaged:resolve(Bun.env.SATURN_PROJECT??'../saturn-examples/pumping-station');
}
function stateRoot(projectDir:string){
  if(Bun.env.SATURN_DATA_DIR)return resolve(Bun.env.SATURN_DATA_DIR);
  const base=process.platform==='win32'?(Bun.env.LOCALAPPDATA??homedir()):join(homedir(),'.local','share');
  return join(base,'Saturn','workspaces',Bun.hash(projectDir).toString(16));
}
function openWindow(url:string){
  if(process.platform==='win32'){
    const edge=[join(Bun.env['ProgramFiles(x86)']??'','Microsoft','Edge','Application','msedge.exe'),join(Bun.env.ProgramFiles??'','Microsoft','Edge','Application','msedge.exe')].find(existsSync);
    if(edge){Bun.spawn([edge,`--app=${url}`,'--start-maximized'],{stdout:'ignore',stderr:'ignore'});return;}
    Bun.spawn(['cmd','/c','start','',url],{stdout:'ignore',stderr:'ignore'});return;
  }
  if(process.platform==='darwin'){Bun.spawn(['open',url],{stdout:'ignore',stderr:'ignore'});return;}
  Bun.spawn(['xdg-open',url],{stdout:'ignore',stderr:'ignore'});
}

const args=Bun.argv.slice(2),exeDir=dirname(process.execPath);
const positional=args.find(arg=>!arg.startsWith('-'));
const requested=positional??Bun.env.SATURN_PROJECT;
const projectDir=requested?(isAbsolute(requested)?requested:resolve(requested)):defaultProject(exeDir);
if(!existsSync(join(projectDir,'project.ts')))throw new Error(`Saturn project not found: ${projectDir}`);
const port=Number(valueAfter('--port',args)??Bun.env.PORT??3000);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid --port');
const app=await createApp({appRoot:packagedRoot(exeDir),projectDir,dataDir:stateRoot(projectDir),port});
console.log(`Saturn IDE  ${app.server.url}\nProject     ${app.workspace.root}\nMode        ${app.state().mode}\nStorage     ${app.state().adapter}`);
if(!args.includes('--no-open'))openWindow(String(app.server.url));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void app.close().then(()=>process.exit(0)));

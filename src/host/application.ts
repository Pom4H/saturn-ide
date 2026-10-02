import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, statSync } from 'node:fs';
const usage=`Usage:
  saturn init <directory> [--template empty|pumping-station|smart-home]
  saturn gui --project <directory> [--port 3000] [--manual] [--no-open]
  saturn serve --project <directory> [--port 3000] [--manual]
  saturn cli [--url http://127.0.0.1:3000] [command]
  saturn tui [url]
  saturn worker <config.json>`;
/** The installed and source distributions enter the same composition roots. */
export async function application(argv:string[]) {
  const args=[...argv],mode=args[0]&&!args[0].startsWith('-')?args.shift()!:'gui';
  if(mode==='help'||args[0]==='--help'){console.log(usage);return;}
  if(mode==='init'){
    const {createProject}=await import('../workspace/project-template');const destination=args.shift();
    if(!destination||destination.startsWith('-'))throw new Error('Usage: saturn init <directory> [--template empty|pumping-station|smart-home]');
    let template:'empty'|'pumping-station'|'smart-home'='empty';
    while(args.length){const flag=args.shift();if(flag!=='--template')throw new Error('Unknown init option: '+flag);const value=args.shift();if(value!=='empty'&&value!=='pumping-station'&&value!=='smart-home')throw new Error('Expected --template empty|pumping-station|smart-home');template=value;}
    console.log('Created project: '+createProject(destination,{template}));
    console.log('Next: from the new directory run `saturn gui --project .`, or from the Saturn IDE checkout run `bun start gui --project <directory>`.');
    if(template==='pumping-station')console.log('The station example imports React. Install its project dependencies after configuring Git access to the pinned core dependency.');
    return;
  }
  if(mode==='worker'){const {createWorkerHost}=await import('./worker');const file=args[0];if(!file)throw new Error('Worker config required');const host=await createWorkerHost({...await Bun.file(file).json(),token:process.env.SATURN_WORKER_TOKEN??''});console.log('Saturn worker '+host.server.url);for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void host.close().then(()=>process.exit(0)));return;}
  if(mode==='cli'){const {cli}=await import('./cli');process.exitCode=await cli(args);return;}
  if(mode==='tui'){const {runTerminal}=await import('./terminal');await runTerminal(args[0]);return;}
  if(mode!=='gui'&&mode!=='serve')throw new Error(usage);
  let projectDir=resolve('.'),port=3000,open=mode==='gui',preview:'manual'|'simulation'='simulation';
  while(args.length){const flag=args.shift();if(flag==='--no-open')open=false;else if(flag==='--manual')preview='manual';else if(flag==='--project'){const value=args.shift();if(!value)throw new Error('Missing project directory');projectDir=resolve(value);}else if(flag==='--port'){port=Number(args.shift());if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');}else throw new Error('Unknown option: '+flag);}
  const entry=join(projectDir,'project.ts');
  if(!existsSync(entry)||!statSync(entry).isFile())throw new Error(`Saturn project not found in ${projectDir}: expected project.ts. Create one with “saturn init <directory>” or select an existing project with --project.`);
  const {createApp}=await import('./dev');
  const dataDir=Bun.env.SATURN_DATA_DIR??join(homedir(),'.saturn','workspaces',new Bun.CryptoHasher('sha256').update(projectDir).digest('hex').slice(0,16));
  const app=await createApp({projectDir,dataDir,port,preview});
  console.log(`Saturn IDE  ${app.server.url}\nProject     ${projectDir}`);
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void app.close().then(()=>process.exit(0)));
  if(open){const url=app.server.url.href;const command=process.platform==='darwin'?['open',url]:process.platform==='win32'?['rundll32','url.dll,FileProtocolHandler',url]:['xdg-open',url];try{const child=Bun.spawn(command,{stdout:'ignore',stderr:'ignore'});if(await child.exited!==0)console.error('Open this URL in your browser: '+url);}catch{console.error('Open this URL in your browser: '+url);}}
}
if(import.meta.main)try{await application(Bun.argv.slice(2));}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}

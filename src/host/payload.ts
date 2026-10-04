import { mkdirSync, existsSync, mkdtempSync, renameSync, rmSync, writeFileSync, symlinkSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { unzipSync } from 'fflate';
/** Embedded compiler, source/type libraries and native TUI assets live in an immutable versioned cache.
 * They are IDE implementation, never copied into an authored project. */
export async function standalone(payload:string,version:string,digest:string){
  const args=Bun.argv.slice(2);
  if(args.includes('--version')){console.log(`Saturn ${version} · Bun ${Bun.version} · ${process.platform}-${process.arch}`);return;}
  if(args[0]==='--help'){console.log('saturn gui [--project <directory>] [--port 3000] [--no-open] [--manual]\nsaturn serve --project <directory> [--port 3000] [--manual]\nsaturn init <directory>\nsaturn cli [--url http://127.0.0.1:3000] [--json] <command>\nsaturn tui [http://127.0.0.1:3000]\nGUI without a project opens the create/open/connect screen in your system browser. Git is required for source control and cloning; local project creation also works without Git.');return;}
  const cache=process.env.SATURN_CACHE_DIR??join(homedir(),'.saturn','ide');mkdirSync(cache,{recursive:true});
  const root=join(cache,`${version}-${digest.slice(0,16)}`);
  if(!existsSync(join(root,'ready'))){
    const bytes=new Uint8Array(await Bun.file(payload).arrayBuffer());
    if(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')!==digest)throw new Error('Damaged embedded IDE payload');
    const staging=mkdtempSync(join(cache,'unpack-'));
    try{for(const [path,body]of Object.entries(unzipSync(bytes))){if(path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>p==='..'||p==='')||path.includes(':'))throw new Error('Invalid payload path');const file=join(staging,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);}
      mkdirSync(join(staging,'bin'));const bun=join(staging,'bin',process.platform==='win32'?'bun.exe':'bun');if(process.platform==='win32')copyFileSync(process.execPath,bun);else symlinkSync(process.execPath,bun);
      writeFileSync(join(staging,'ready'),digest);
      try{renameSync(staging,root);}catch(error){if(!existsSync(join(root,'ready')))throw error;}
    }finally{rmSync(staging,{recursive:true,force:true});}
  }
  const child=Bun.spawn([process.execPath,join(root,'src/host/application.ts'),...args],{stdin:'inherit',stdout:'inherit',stderr:'inherit',env:{...process.env,BUN_BE_BUN:'1',SATURN_IDE_VERSION:version,PATH:join(root,'bin')+(process.platform==='win32'?';':':')+(process.env.PATH??'')}});
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>child.kill(signal));
  process.exitCode=await child.exited;
}

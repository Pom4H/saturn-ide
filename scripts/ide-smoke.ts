import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const binary=resolve(`artifacts/distribution/saturn-${process.platform}-${process.arch}${process.platform==='win32'?'.exe':''}`),dir=mkdtempSync(join(tmpdir(),'saturn-executable-')),project=join(dir,'project');mkdirSync(project);
await Bun.write(join(project,'project.ts'),`import {project,signal,report,reportSchema,numberField,reportColumn} from '@saturn/core'; const pressure=signal('pressure',{initial:1}),schema=reportSchema({value:numberField()});export default project({id:'binary-smoke',label:'Binary smoke',signals:{pressure},equipment:[],pipes:[],alarms:[],reports:[report('smoke-report',{label:'Report',signals:[pressure],schema,columns:[reportColumn('Value',schema.value)],window:1000,sql:'SELECT 12.5 AS value'})]});`);
const env={...process.env,SATURN_CACHE_DIR:join(dir,'cache'),SATURN_DATA_DIR:join(dir,'data')};
async function command(args:string[]){const p=Bun.spawn([binary,...args],{cwd:dir,env,stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw new Error(err||out);return out;}
let server:ReturnType<typeof Bun.spawn>|undefined;
try{
  if(!(await command(['--version'])).includes('Saturn'))throw new Error('Version failed');
  if(!JSON.parse(await command(['cli','--schema'])).some((c:{path:string})=>c.path==='runtime status'))throw new Error('CLI schema failed');
  server=Bun.spawn([binary,'serve','--project',project,'--port','0','--manual'],{cwd:dir,env,stdout:'pipe',stderr:'pipe'});
  const stream=server.stdout;if(typeof stream==='number'||!stream)throw new Error('No stdout');const reader=stream.getReader();let output='';const timeout=setTimeout(()=>server?.kill(),45000);
  try{while(!output.match(/http:\/\/[^\s]+/)){const chunk=await reader.read();if(chunk.done)throw new Error('Server exited: '+output+' '+await new Response(typeof server.stderr==='number'?undefined:server.stderr).text());output+=new TextDecoder().decode(chunk.value);}}finally{clearTimeout(timeout);reader.releaseLock();}
  const url=output.match(/http:\/\/[^\s]+/)![0]!;
  const state=await fetch(url+'api/state').then(r=>r.json());if(state.project.id!=='binary-smoke'||state.problems.length)throw new Error(JSON.stringify(state.problems));
  const html=await fetch(url).then(r=>r.text());if(!html.includes('/assets/app.js'))throw new Error('GUI bundle absent');
  const result=JSON.parse(await command(['cli','--url',url,'--json','runtime','status']));if(!result.ok)throw new Error('CLI did not attach');
  const to=Date.now(),report=await fetch(url+'api/report?id=smoke-report&from='+(to-1000)+'&to='+to).then(r=>r.json());if(report.rows?.[0]?.value!==12.5)throw new Error('Embedded SQL process failed: '+JSON.stringify(report));const xlsx=await fetch(url+'api/report?artifact='+report.artifactId+'&format=xlsx');if(new Uint8Array(await xlsx.arrayBuffer())[0]!==80)throw new Error('Embedded XLSX failed');
  console.log('Standalone typed SQL subprocess and real XLSX, GUI bundle, real TS project, CLI schema and attached runtime status passed on '+process.platform+'-'+process.arch);
}finally{if(server){server.kill('SIGTERM');await server.exited;}rmSync(dir,{recursive:true,force:true});}

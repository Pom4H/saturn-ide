import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/runtime/store';
import {RevisionStore} from '../src/runtime/revisions';
import {createWorkerHost} from '../src/host/worker';
import {createArtifact,digest} from '../src/core/artifact';
import {signal,project,report,reportSchema,numberField,reportColumn} from '../src/core';
const dir=mkdtempSync(join(tmpdir(),'saturn-report-worker-')),database=`sqlite://${join(dir,'history.sqlite')}`,store=new Store(database);await store.init();const revisions=new RevisionStore(store.sql);await revisions.init();
const s=signal('flow',{initial:0,staleAfter:5000}),schema=reportSchema({value:numberField()}),definition=report('sql',{label:'SQL worker',signals:[s],schema,columns:[reportColumn('Value',schema.value)],window:1000,inputs:{scale:{type:'number',default:1,min:1,max:10}},sql:"SELECT SUM(value*(end-start))/SUM(end-start)*:scale AS value FROM segments WHERE quality='good'"}),model=project({id:'worker',label:'Worker',equipment:[],pipes:[],reports:[definition]}),artifact=await createArtifact(model,null,{sourceRevision:null,sourceDigest:await digest('source'),coreHash:await digest('core'),lockHash:null,bunVersion:Bun.version});await revisions.put(artifact);const to=Date.now()-1000,from=to-1000;await store.append([{signal:s.id,at:from,value:12.5,quality:'good'}]);
const options={directory:join(dir,'worker'),token:'report-test-token-'+crypto.randomUUID(),port:0,projects:{project:{root:dir,database}}};let host=await createWorkerHost(options);
const get=(path:string)=>fetch(new URL(path,host.server.url),{headers:{authorization:'Bearer '+options.token}});
try{const input={kind:'report',project:'project',run:'typed',build:artifact.hash,report:'sql',from,to,inputs:{scale:2}},submit=()=>fetch(new URL('/api/jobs',host.server.url),{method:'POST',headers:{authorization:'Bearer '+options.token,'content-type':'application/json'},body:JSON.stringify(input)});assert.equal((await submit()).status,202);
 for(let i=0;i<100;i++){const r=await host.jobs.get('typed.report');if(r?.state==='succeeded')break;if(r?.state==='failed')throw new Error(r.error);await Bun.sleep(50);}
 const receipt=await host.jobs.get('typed.report');assert.equal(receipt?.state,'succeeded');assert.equal((receipt.result as {report:{rows:{value:number}[]}}).report.rows[0]?.value,25);assert.equal((await submit()).status,202);assert.equal((await host.jobs.list('project')).length,1);
 const path='/api/report-artifact?project=project&job=typed.report&format=xlsx',bytes=new Uint8Array(await (await get(path)).arrayBuffer());assert.equal(bytes[0],80);await host.close();host=await createWorkerHost(options);await store.sql`DELETE FROM samples`;assert.deepEqual(new Uint8Array(await (await get(path)).arrayBuffer()),bytes);assert.notEqual((await get('/api/report-artifact?project=other&job=typed.report')).status,200);assert.equal((await fetch(new URL(path,host.server.url))).status,401);
 console.log('PASS real Bun Worker typed SQL/inputs, idempotent receipt, XLSX auth/project binding, restart and archive pruning preserve artifact bytes');
}finally{await host.close();await store.close();rmSync(dir,{recursive:true,force:true});}

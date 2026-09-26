import { isAttached, type ConnectionEnd } from '../src/core';
const attachedPort = (end:ConnectionEnd|undefined) => end && isAttached(end) ? end.port : undefined;
const attachedDevice = (end:ConnectionEnd|undefined) => end && isAttached(end) ? end.device : undefined;
const isFree = (end:ConnectionEnd|undefined) => !!end && !isAttached(end);
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createApp } from '../src/host/dev';
import type { IDEState } from '../src/protocol';
import type { ResourceCatalog } from '../src/core/resources';
import type { SourceFile } from '../src/workspace/files';
import { fixture } from './helpers';
import { Store } from '../src/runtime/store';
import { RevisionStore } from '../src/runtime/revisions';
import { createArtifact, digest } from '../src/core/artifact';
import demo from '@saturn/example';
test('cable plug edit rewrites one authored endpoint and checks port compatibility',async()=>{
  const f=fixture(),app=await createApp({projectDir:f.root,dataDir:f.dir,databaseUrl:':memory:',port:0});
  try{
    const before=app.workspace.read('project.ts'),key=app.state().key;
    const post=(body:unknown)=>fetch(new URL('api/cable/endpoint',app.server.url),{method:'POST',headers:{'Content-Type':'application/json','X-Saturn-Key':key},body:JSON.stringify(body)});
    const request={id:'run-command',end:'from',device:'PLC-01',port:'DO2'};
    const preview=await (await post(request)).json() as {path:string;version:string;source:string;from:string;to:string};
    expect(preview.path).toBe('project.ts');expect(preview.source).toContain('controller.ports.DO2');
    expect(app.workspace.read('project.ts').source).toBe(before.source);
    expect((await post({...request,version:'0'.repeat(64),apply:true})).status).toBe(409);
    expect((await post({...request,version:preview.version,apply:true})).status).toBe(200);
    expect(app.workspace.read('project.ts').source).toContain('from: controller.ports.DO2');
    expect(attachedPort(app.state().project.cables?.find(item=>item.id==='run-command')?.from)).toBe('DO2');
    const detached={id:'run-command',end:'from',disconnect:true,x:210,y:115,z:26};
    const loose=await (await post(detached)).json() as {path:string;version:string;source:string};
    expect(loose.source).toContain("__saturnFree(controller.ports.DO2");
    expect((await post({...detached,version:loose.version,apply:true})).status).toBe(200);
    expect(isFree(app.state().project.cables?.find(item=>item.id==='run-command')?.from)).toBe(true);
    const reconnect={id:'run-command',end:'from',device:'PLC-01',port:'DO1'};
    const attached=await (await post(reconnect)).json() as {path:string;version:string;source:string};
    const run=attached.source.slice(attached.source.indexOf("cable('run-command'"),attached.source.indexOf("cable('valve-command'"));
    expect(run).toContain('from: controller.ports.DO1');
    expect(run).not.toContain('__saturnFree');
    expect((await post({...reconnect,version:attached.version,apply:true})).status).toBe(200);
    expect(isFree(app.state().project.cables?.find(item=>item.id==='run-command')?.from)).toBe(false);
    expect((await post({id:'run-command',end:'from',device:'PLC-01',port:'ETH'})).status).toBe(400);
  }finally{await app.close();f.clean();}
},60000);
test('real dev host: simulator preview, telemetry, safe writes and last-good applied build', async () => {
  const f = fixture(), app = await createApp({ projectDir: f.root, dataDir: f.dir, databaseUrl: ':memory:', port: 0 });
  try {
    const base = app.server.url, state = await fetch(new URL('api/state', base)).then(r => r.json()) as IDEState;
    expect(state.problems).toEqual([]); expect(state.mode).toBe('simulation'); expect(state.snapshot.samples['P-01.rpm']?.value).toBe(1450);
    const catalog = await fetch(new URL('api/resources', base)).then(r => r.json()) as ResourceCatalog;
    const pump = catalog.resources.find(r => r.entityId === 'P-01')!;
    expect(pump.icon).toBe('pump'); expect(pump.source?.path).toBe('equipment/P-01.device.ts');
    expect(pump.semanticId).toBe('equipment:booster-primary');
    const semantic = await fetch(new URL('api/semantic', base)).then(r => r.json()) as {id:string;semanticId:string}[];
    expect(semantic.some(node => node.semanticId === 'equipment:booster-primary' && node.id === 'P-01')).toBe(true);
    const impact = await fetch(new URL('api/impact?id=P-01.pressure', base)).then(r => r.json()) as {transitive:{id:string}[]};
    expect(impact.transitive.some(node => node.id === 'high-pressure')).toBe(true);
    expect(catalog.resources.filter(r => r.source?.path === pump.source?.path)).toHaveLength(1);
    const post = (path: string, body: unknown, headers: Record<string,string> = {}) => fetch(new URL(`api/${path}`, base), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Saturn-Key': state.key, ...headers }, body: JSON.stringify(body) });
    expect((await post('command', { signal:'P-01.run', value:false }, { 'X-Saturn-Key':'wrong' })).status).toBe(403);
    expect((await post('command', { signal:'P-01.run', value:false }, { Origin:'https://evil.test' })).status).toBe(403);
    expect((await post('command', { signal:'P-01.run', value:false })).status).toBe(200);
    await Bun.sleep(1200); expect(app.state().snapshot.samples['P-01.run']?.value).toBe(false);
    const file = app.workspace.read('equipment/P-01.device.ts');
    const movedX = state.project.equipment.find(e=>e.id==='P-01')!.x + 40;
    const saved = await (await post('file', { ...file, source:file.source.replace(/\bx:\s*-?\d+/, `x: ${movedX}`) })).json() as { file:SourceFile; state:IDEState };
    expect(saved.state.problems).toEqual([]); expect(saved.state.project.equipment.find(e => e.id==='P-01')?.x).toBe(movedX);
    await Bun.sleep(1100); expect(app.state().snapshot.samples['P-01.run']?.value).toBe(false);
    const bad = await (await post('file',{...saved.file,source:saved.file.source.replace(`x: ${movedX}`,'x: "bad"')})).json() as {state:IDEState};
    expect(bad.state.problems.length).toBeGreaterThan(0); expect(bad.state.revision).toBe(saved.state.revision);
    expect(bad.state.project.equipment.find(e=>e.id==='P-01')?.x).toBe(movedX);
    expect((await post('file',{...file,source:file.source})).status).toBe(409);
    expect((await fetch(new URL('api/file?path=../package.json',base))).status).toBe(400);
  } finally { await app.close(); f.clean(); }
}, 60000);
test('manual preview: saving cannot publish/apply until explicitly requested', async () => {
  const f=fixture(), app=await createApp({projectDir:f.root,dataDir:f.dir,databaseUrl:':memory:',port:0,preview:'manual'});
  try {
    const releases=()=>fetch(new URL('api/releases',app.server.url)).then(r=>r.json()) as Promise<{key:string;checked:string;published:string|null;applied:string|null}>;
    const initial=await releases(); expect(initial.checked).toStartWith('sha256:'); expect(initial.applied).toBeNull();
    const post=(path:string,body:unknown)=>fetch(new URL(`api/${path}`,app.server.url),{method:'POST',headers:{'Content-Type':'application/json','X-Saturn-Key':initial.key},body:JSON.stringify(body)});
    expect((await post('publish',{hash:initial.checked,expectedPublished:null})).ok).toBe(true);
    expect((await post('apply',{hash:initial.checked,expectedApplied:null})).ok).toBe(true);
    const originalX=app.state().project.equipment.find(e=>e.id==='P-01')!.x;
    const file=app.workspace.read('equipment/P-01.device.ts');await post('file',{...file,source:file.source.replace(/\bx:\s*-?\d+/, `x: ${originalX+25}`)});
    const next=await releases();expect(next.checked).not.toBe(initial.checked);expect(next.applied).toBe(initial.checked);expect(next.published).toBe(initial.checked);
    expect(app.state().project.equipment.find(e=>e.id==='P-01')?.x).toBe(originalX);
    expect((await post('apply',{hash:next.checked,expectedApplied:initial.checked})).status).toBe(409);
  } finally {await app.close();f.clean();}
},60000);

test('unrestorable applied build leaves startup offline and retains its durable identity', async () => {
  const f = fixture(), databaseUrl = `sqlite://${join(f.dir, 'history.sqlite')}`;
  const store = new Store(databaseUrl); await store.init();
  const revisions = new RevisionStore(store.sql); await revisions.init();
  const legacy = { ...demo, equipment: demo.equipment.map(({ icon, ports, capabilities, knowledge, alarms, ...equipment }) => equipment) };
  const artifact = await createArtifact(legacy, null, {
    sourceRevision: null, sourceDigest: await digest('legacy source'), coreHash: await digest('legacy core'), lockHash: null, bunVersion: Bun.version,
  });
  await revisions.put(artifact); await revisions.publish(artifact.hash, null); await revisions.apply(artifact.hash, null); await store.close();
  const app = await createApp({ projectDir: f.root, dataDir: f.dir, databaseUrl, port: 0 });
  try {
    expect(app.state().mode).toBe('offline');
    expect(app.state().revision).toBe(artifact.hash.slice(7));
    expect(app.state().problems.some(problem => problem.code === 'APPLIED_RESTORE')).toBe(true);
    const releases = await fetch(new URL('api/releases', app.server.url)).then(response => response.json()) as { applied: string; checked: string };
    expect(releases.applied).toBe(artifact.hash);
    expect(releases.checked).not.toBe(artifact.hash);
  } finally { await app.close(); f.clean(); }
}, 60000);

test('driver.write may await publish without deadlocking the observation queue', async () => {
  const f = fixture();
  writeFileSync(join(f.root, 'server.ts'), `import type { Driver, Value } from '@saturn/core';
let publish: (values: Record<string, Value>) => Promise<void> = async () => {};
export default { mode: 'simulation', async start(context) {
  publish = context.publish; await publish({ 'P-01.run': false });
  return () => { publish = async () => {}; };
}, async write(id, value) { await publish({ [id]: value }); } } satisfies Driver;
`);
  const app = await createApp({ projectDir: f.root, dataDir: f.dir, databaseUrl: ':memory:', port: 0 });
  try {
    expect(app.state().problems).toEqual([]);
    const response = await fetch(new URL('api/command', app.server.url), {
      method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { 'Content-Type': 'application/json', 'X-Saturn-Key': app.state().key },
      body: JSON.stringify({ signal: 'P-01.run', value: true }),
    });
    expect(response.ok).toBe(true);
    expect(app.state().snapshot.samples['P-01.run']?.value).toBe(true);
  } finally { await app.close(); f.clean(); }
}, 60000);

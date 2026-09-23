import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createApp } from '../src/host/dev';
import type { IDEState } from '../src/protocol';
import type { ResourceCatalog } from '../src/core/resources';
import type { SourceFile } from '../src/workspace/files';
import { fixture } from './helpers';
test('real dev host: simulator preview, telemetry, safe writes and last-good applied build', async () => {
  const f = fixture(), app = await createApp({ projectDir: f.root, dataDir: f.dir, databaseUrl: ':memory:', port: 0 });
  try {
    const base = app.server.url, state = await fetch(new URL('api/state', base)).then(r => r.json()) as IDEState;
    expect(state.problems).toEqual([]); expect(state.mode).toBe('simulation'); expect(state.snapshot.samples['pump.rpm']?.value).toBe(1450);
    const catalog = await fetch(new URL('api/resources', base)).then(r => r.json()) as ResourceCatalog;
    const pump = catalog.resources.find(r => r.entityId === 'P-01')!;
    expect(pump.icon).toBe('pump'); expect(pump.source?.path).toBe('equipment/P-01.device.ts');
    expect(catalog.resources.filter(r => r.source?.path === pump.source?.path)).toHaveLength(1);
    const post = (path: string, body: unknown, headers: Record<string,string> = {}) => fetch(new URL(`api/${path}`, base), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Saturn-Key': state.key, ...headers }, body: JSON.stringify(body) });
    expect((await post('command', { signal:'pump.run', value:false }, { 'X-Saturn-Key':'wrong' })).status).toBe(403);
    expect((await post('command', { signal:'pump.run', value:false }, { Origin:'https://evil.test' })).status).toBe(403);
    expect((await post('command', { signal:'pump.run', value:false })).status).toBe(200);
    await Bun.sleep(1200); expect(app.state().snapshot.samples['pump.run']?.value).toBe(false);
    const file = app.workspace.read('equipment/P-01.device.ts');
    const saved = await (await post('file', { ...file, source:file.source.replace('x: 335','x: 375') })).json() as { file:SourceFile; state:IDEState };
    expect(saved.state.problems).toEqual([]); expect(saved.state.project.equipment.find(e => e.id==='P-01')?.x).toBe(375);
    await Bun.sleep(1100); expect(app.state().snapshot.samples['pump.run']?.value).toBe(false);
    const bad = await (await post('file',{...saved.file,source:saved.file.source.replace('x: 375','x: "bad"')})).json() as {state:IDEState};
    expect(bad.state.problems.length).toBeGreaterThan(0); expect(bad.state.revision).toBe(saved.state.revision);
    expect(bad.state.project.equipment.find(e=>e.id==='P-01')?.x).toBe(375);
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
    const file=app.workspace.read('equipment/P-01.device.ts');await post('file',{...file,source:file.source.replace('x: 335','x: 360')});
    const next=await releases();expect(next.checked).not.toBe(initial.checked);expect(next.applied).toBe(initial.checked);expect(next.published).toBe(initial.checked);
    expect(app.state().project.equipment.find(e=>e.id==='P-01')?.x).toBe(335);
    expect((await post('apply',{hash:next.checked,expectedApplied:initial.checked})).status).toBe(409);
  } finally {await app.close();f.clean();}
},60000);

test('driver.write may await publish without deadlocking the observation queue', async () => {
  const f = fixture();
  writeFileSync(join(f.root, 'server.ts'), `import type { Driver, Value } from '@saturn/core';
let publish: (values: Record<string, Value>) => Promise<void> = async () => {};
export default { mode: 'simulation', async start(context) {
  publish = context.publish; await publish({ 'pump.run': false });
  return () => { publish = async () => {}; };
}, async write(id, value) { await publish({ [id]: value }); } } satisfies Driver;
`);
  const app = await createApp({ projectDir: f.root, dataDir: f.dir, databaseUrl: ':memory:', port: 0 });
  try {
    expect(app.state().problems).toEqual([]);
    const response = await fetch(new URL('api/command', app.server.url), {
      method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { 'Content-Type': 'application/json', 'X-Saturn-Key': app.state().key },
      body: JSON.stringify({ signal: 'pump.run', value: true }),
    });
    expect(response.ok).toBe(true);
    expect(app.state().snapshot.samples['pump.run']?.value).toBe(true);
  } finally { await app.close(); f.clean(); }
}, 60000);

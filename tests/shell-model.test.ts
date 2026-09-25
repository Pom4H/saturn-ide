import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Documents, type DocumentPort, type SourceFile } from '../src/shell/model/documents';
import { ShellSession } from '../src/shell/model/session';
import { resourceUri, availableEditors, findResources, type ResourceCatalog, type ProjectResource } from '../src/core/resources';
import { SSEDecoder } from '../src/shell/model/sse';
const name = { en: 'Booster pump', ru: 'Повысительный насос' };
const resource: ProjectResource = { uri: resourceUri('station', 'device', 'P-01'), name, kind: 'device', icon: 'pump', entityId: 'P-01', source: { path: 'equipment/P-01.device.ts' }, editors: ['diagram', 'source', 'signals', 'hmi'], related: [] };
const catalog: ResourceCatalog = { project: resourceUri('station', 'project', 'station'), revision: 'build-a', resources: [resource] };
function port() {
  let file: SourceFile = { path: resource.source!.path, source: 'original', version: '1' }, saves = 0;
  return { get saves() { return saves; }, async read() { return { ...file }; }, async save(next: SourceFile) {
    assert.equal(next.version, file.version); saves++; file = { ...next, version: String(saves + 1) }; return file;
  } } satisfies DocumentPort & { readonly saves: number };
}
test('browser and terminal execute the same resource/source commands', async () => {
  for (const host of ['browser', 'terminal'] as const) {
    const io = port(), session = new ShellSession(host, io); session.replaceCatalog(catalog);
    await session.execute({ type: 'open', uri: resource.uri });
    assert.equal(session.getSnapshot().selected, 'P-01');
    session.documents.edit(resource.source!.path, 'new draft');
    await session.execute({ type: 'open', uri: resource.uri, editor: 'source' });
    assert.equal(session.getSnapshot().tabs.length, 2);
    assert.equal(session.documents.getSnapshot().get(resource.source!.path)?.draft, 'new draft');
    await session.execute({ type: 'save' }); assert.equal(io.saves, 1); assert.equal(session.documents.dirty, false);
  }
});
test('multiple resources backed by one file share one buffer', async () => {
  const io = port(), session = new ShellSession('browser', io);
  const other = { ...resource, uri: resourceUri('station', 'device', 'P-02'), entityId: 'P-02' };
  session.replaceCatalog({ ...catalog, resources: [resource, other] });
  await session.execute({ type: 'open', uri: resource.uri }); session.documents.edit(resource.source!.path, 'draft');
  await session.execute({ type: 'open', uri: other.uri, editor: 'source' });
  assert.equal(session.documents.getSnapshot().size, 1); assert.equal(session.documents.getSnapshot().get(resource.source!.path)?.draft, 'draft');
});
test('diagram and real source files have independent stable tabs and one shared buffer per path', async () => {
  const root:ProjectResource={...resource,uri:catalog.project,kind:'project',entityId:undefined,source:{path:'project.ts'},editors:['diagram','source','signals','docs']};
  const other={...resource,uri:resourceUri('station','device','P-02'),entityId:'P-02',source:{path:'equipment/P-02.device.ts'}};
  const session=new ShellSession('browser',{read:async path=>({path,source:`// ${path}`,version:'1'}),save:async file=>file});
  session.replaceCatalog({...catalog,resources:[root,resource,other]});
  await session.execute({type:'open',uri:resource.uri,editor:'diagram'});
  await session.execute({type:'open',uri:resource.uri,editor:'source'});
  session.documents.edit(resource.source!.path,'retained draft');
  await session.execute({type:'open',uri:other.uri,editor:'diagram'});
  assert.equal(session.getSnapshot().tabs.filter(tab=>tab.editor==='diagram').length,1);
  assert.equal(session.getSnapshot().active?.uri,root.uri);
  assert.equal(session.getSnapshot().selected,'P-02');
  await session.execute({type:'open',uri:other.uri,editor:'source'});
  const ids=session.getSnapshot().tabs.map(tab=>tab.id);
  await session.execute({type:'open',uri:resource.uri,editor:'source'});
  assert.deepEqual(session.getSnapshot().tabs.map(tab=>tab.id),ids);
  assert.equal(session.getSnapshot().source,resource.source!.path);
  assert.equal(session.documents.getSnapshot().get(resource.source!.path)?.draft,'retained draft');
  assert.equal(session.getSnapshot().tabs.length,3);
});
test('closing a view preserves a dirty source; source close is guarded; final close leaves no active tab', async () => {
  const session=new ShellSession('browser',port());session.replaceCatalog(catalog);
  await session.execute({type:'open',uri:resource.uri,editor:'diagram'});
  await session.execute({type:'open',uri:resource.uri,editor:'source'});
  session.documents.edit(resource.source!.path,'draft');
  await session.execute({type:'close',uri:resource.uri,editor:'diagram'});
  assert.equal(session.getSnapshot().surface,'source');
  await assert.rejects(session.execute({type:'close',uri:resource.uri,editor:'source'}),/Save or discard/);
  await session.execute({type:'save'});
  await session.execute({type:'open',uri:resource.uri,editor:'diagram'});
  await session.execute({type:'close',uri:resource.uri,editor:'diagram'});
  assert.equal(session.getSnapshot().active?.editor,'source');
  await session.execute({type:'close',uri:resource.uri,editor:'source'});
  assert.equal(session.getSnapshot().active,null);assert.deepEqual(session.getSnapshot().tabs,[]);
});
test('rename display labels and source paths do not create another entity identity', () => {
  const session = new ShellSession('browser', port()); session.replaceCatalog(catalog);
  const changed = { ...resource, name: { en: 'Renamed', ru: 'Новое имя' }, source: { path: 'new/place.ts' } };
  session.replaceCatalog({ ...catalog, resources: [changed] });
  assert.equal(session.resource(resource.uri).name.ru, 'Новое имя');
  assert.equal(findResources(session.getCatalog(), 'new/place', 'en')[0]?.uri, resource.uri);
  assert.notEqual(resourceUri('station', 'device', 'a/b'), resourceUri('station', 'device', 'a%2Fb'));
});
test('capabilities reject graphical HMI in terminal and source without backing', async () => {
  assert.equal(availableEditors(resource, 'terminal').includes('hmi'), false);
  const session = new ShellSession('terminal', port()); session.replaceCatalog(catalog);
  await assert.rejects(session.execute({ type: 'open', uri: resource.uri, editor: 'hmi' }), /unavailable/);
  session.replaceCatalog({ ...catalog, resources: [{ ...resource, source: undefined }] });
  await assert.rejects(session.execute({ type: 'open', uri: resource.uri, editor: 'source' }), /unavailable/);
});
test('opening is read-only and closing dirty tabs cannot discard a draft', async () => {
  const io = port(), session = new ShellSession('browser', io); session.replaceCatalog(catalog);
  await session.execute({ type: 'open', uri: resource.uri, editor:'source' }); assert.equal(io.saves, 0);
  session.documents.edit(resource.source!.path, 'draft');
  await assert.rejects(session.execute({ type: 'close', uri: resource.uri }), /Save or discard/);
  assert.equal(session.getSnapshot().tabs.length, 1);
});
test('a late save preserves newer typing and saves the new version on next save', async () => {
  let resolve!: (file: SourceFile) => void;
  const docs = new Documents({ read: port().read, save: () => new Promise(r => { resolve = r; }) });
  const path = resource.source!.path; await docs.open(path); docs.edit(path, 'first');
  const saving = docs.save(path); assert.equal(docs.save(path), saving);
  docs.edit(path, 'newer'); resolve({ path, source: 'first', version: '2' }); await saving;
  assert.equal(docs.getSnapshot().get(path)?.draft, 'newer'); assert.equal(docs.getSnapshot().get(path)?.version, '2'); assert.equal(docs.dirty, true);
});
test('409/conflicting save leaves original version and the entire draft', async () => {
  const docs = new Documents({ read: port().read, save: async () => { throw new Error('409 conflict'); } });
  const path = resource.source!.path; await docs.open(path); docs.edit(path, 'keep me');
  await assert.rejects(docs.save(path), /409/);
  assert.equal(docs.getSnapshot().get(path)?.draft, 'keep me'); assert.equal(docs.getSnapshot().get(path)?.version, '1');
});
test('a late reload cannot overwrite new edits even after discard confirmation', async () => {
  let resolve!: (file: SourceFile) => void, reads = 0; const path = resource.source!.path;
  const docs = new Documents({ save: port().save, read: async () => {
    if (!reads++) return { path, source: 'before', version: '1' };
    return new Promise(r => { resolve = r; });
  } });
  await docs.open(path); docs.edit(path, 'discarded'); const loading = docs.reload(path, true); docs.edit(path, 'new edit');
  resolve({ path, source: 'disk', version: '2' }); await assert.rejects(loading, /changed/);
  assert.equal(docs.getSnapshot().get(path)?.draft, 'new edit');
});
test('catalog rejects duplicate IDs and cross-project implicit session reuse', () => {
  const session = new ShellSession('browser', port()); session.replaceCatalog(catalog);
  assert.throws(() => session.replaceCatalog({ ...catalog, resources: [resource, resource] }), /Duplicate/);
  assert.throws(() => session.replaceCatalog({ ...catalog, project: 'another-project' }), /new session/);
});
test('SSE survives byte/chunk boundaries, unicode, CRLF, comments and multiline data', () => {
  const events: { type: string; text: string }[] = [];
  const parser = new SSEDecoder((type, text) => events.push({ type, text }));
  const bytes = new TextEncoder().encode(': keepalive\r\nevent: project\r\ndata: {"name":"Насос 🪐",\r\ndata: "n":1}\r\n\r\nevent: telemetry\ndata: {}\n\n');
  for (const byte of bytes) parser.feed(Uint8Array.of(byte));
  assert.equal(events.length, 2); assert.equal(JSON.parse(events[0]!.text).name, 'Насос 🪐'); assert.equal(events[1]?.type, 'telemetry');
});

test('same-workspace authored identity changes remap tabs and preserve drafts in both hosts',async()=>{
  for(const host of ['browser','terminal'] as const){
    const session=new ShellSession(host,port()),root:ProjectResource={uri:catalog.project,kind:'project',name,icon:'project',source:{path:'project.ts'},editors:['diagram','source'],related:[]};
    session.replaceCatalog({...catalog,workspace:'workspace-a',resources:[root,resource]});
    await session.execute({type:'open',uri:resource.uri,editor:'diagram'});await session.execute({type:'open',uri:resource.uri,editor:'source'});
    session.documents.edit(resource.source!.path,'unsaved engineering change');
    const nextRoot={...root,uri:resourceUri('imported','project','imported')},nextDevice={...resource,uri:resourceUri('imported','device','P-01')};
    const next={...catalog,workspace:'workspace-a',project:nextRoot.uri,resources:[nextRoot,nextDevice]};session.replaceCatalog(next);
    assert.equal(session.getSnapshot().tabs[0]?.uri,nextRoot.uri);assert.equal(session.getSnapshot().active?.uri,nextDevice.uri);
    assert.equal(session.documents.getSnapshot().get(resource.source!.path)?.draft,'unsaved engineering change');
    await assert.rejects(()=>session.execute({type:'close',uri:nextDevice.uri,editor:'source'}),/Save or discard/);
    assert.throws(()=>session.replaceCatalog({...next,workspace:'workspace-b'}),/new session/);
    assert.throws(()=>session.replaceCatalog({...next,project:'other',workspace:undefined}),/new session/);
    assert.equal(session.getCatalog().workspace,'workspace-a');
  }
});

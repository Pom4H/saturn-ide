import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { deviceCalls, mountCoordinates } from '../src/workspace/ast';
import { patchDeviceProperties } from '../src/workspace/device-properties';
import { applyDslProposal, dslCatalog } from '../src/workspace/dsl-proposal';
import { Workspace } from '../src/workspace/files';

const instance = (fields = "label:'Inlet',x:10,y:20,value:signal({initial:2.5})") =>
  `import { signal, bind, protocol } from '@saturn/core';\nimport { sensor } from './equipment/sensor';\nexport const inlet = sensor('PT-01',{${fields}});\n`;
const parse = (source:string) => ts.createSourceFile('project.ts',source,ts.ScriptTarget.Latest,true);
const denied = /read-only|ambiguous|Computed/;

test('project-owned factories remain editable in one file or ordinary modules', () => {
  for (const path of ['project.ts','systems/water.ts','equipment/instruments.ts','equipment/PT-01.device.ts','installation.tsx']) {
    const source=instance(), files={[path]:source}, catalog=dslCatalog(files);
    assert.deepEqual(catalog,[
      {kind:'equipment.label',id:'PT-01',path,value:'Inlet'},
      {kind:'signal.initial',id:'PT-01.value',path,value:2.5},
    ]);
    const changed=applyDslProposal(files,[{kind:'equipment.label',id:'PT-01',value:'Outlet'}]);
    assert.equal(changed[path],source.replace("'Inlet'",'"Outlet"'));
    assert.equal(files[path],source);
  }
});

test('several abstractions in one module retain independent source targets', () => {
  const source=instance()+"export const outlet = meter('FT-01',{label:'Flow',x:100,y:20,flow:signal({initial:8})});\n";
  const changed=applyDslProposal({'project.ts':source},[
    {kind:'equipment.label',id:'PT-01',value:'Pressure'},
    {kind:'signal.initial',id:'FT-01.flow',value:9},
  ])['project.ts'];
  assert.equal(changed,source.replace("'Inlet'",'"Pressure"').replace('initial:8','initial:9'));
});

test('bound signals keep explicit identity and imported aliases', () => {
  const source=`import {signal as reading,bind as wire,protocol} from '@saturn/core';
export const inlet = sensor('PT-01',{label:'Inlet',x:10,y:20,
  'pressure-value':wire(reading('process.pressure',{initial:2.5}),protocol.modbus('bus',0))});`;
  const files={'project.ts':source};
  assert.deepEqual(dslCatalog(files).filter(t=>t.kind==='signal.initial'),[
    {kind:'signal.initial',id:'process.pressure',path:'project.ts',value:2.5},
  ]);
  assert.equal(applyDslProposal(files,[{kind:'signal.initial',id:'process.pressure',value:3}])['project.ts'],source.replace('initial:2.5','initial:3'));
  assert.throws(()=>applyDslProposal(files,[{kind:'signal.initial',id:'PT-01.pressure-value',value:3}]),/Unknown/);
});

test('namespace imports use the same signal and binding contracts', () => {
  const source=`import * as dsl from 'saturn-ide/core';
export const inlet = custom.sensor('PT-01',{label:'Inlet',x:10,y:20,value:dsl.bind(dsl.signal('PT-01.value',{initial:2.5}),dsl.protocol.modbus('bus',0))});
export const high = dsl.alarm('high',{above:5,signal:inlet.value});`;
  assert.deepEqual(dslCatalog({'project.ts':source}).map(t=>t.id),['PT-01','PT-01.value','high']);
});

test('arbitrary bind methods and dynamic signal IDs are not mistaken for the DSL', () => {
  for (const value of ["other.bind(signal({initial:2.5}))","bind(signal(computedId,{initial:2.5}),binding)","signal({initial:2.5,...defaults})"]) {
    assert.equal(dslCatalog({'project.ts':instance(`label:'Inlet',x:10,y:20,value:${value}`)}).some(t=>t.kind==='signal.initial'),false);
  }
});

test('reusable function bodies do not become instance edits', () => {
  for (const declaration of [
    "function station(){return sensor('PT-01',{label:'Template',x:10,y:20,value:signal({initial:1})});}",
    "const station=()=>sensor('PT-01',{label:'Template',x:10,y:20,value:signal({initial:1})});",
    "class Station { create(){return sensor('PT-01',{label:'Template',x:10,y:20});} }",
  ]) {
    const source="import {signal} from '@saturn/core';\n"+declaration;
    assert.deepEqual(deviceCalls(parse(source)),[]);
    assert.deepEqual(dslCatalog({'equipment/station.device.ts':source}),[]);
    assert.throws(()=>patchDeviceProperties(source,'PT-01',{label:'Changed'}),denied);
  }
});

test('property spreads and computed keys cannot silently redirect a drag', () => {
  for (const fields of ['x:10,y:20,...placement','x:10,y:20,[coordinate]:30','x:10,y:20,x:40']) {
    const source=instance(`label:'Inlet',${fields}`);
    assert.deepEqual(deviceCalls(parse(source)),[]);
    assert.throws(()=>patchDeviceProperties(source,'PT-01',{x:50}),denied);
  }
});

test('explicit instance coordinates after defaults are editable', () => {
  const source=instance("...defaults,label:'Inlet',x:10,y:20"),tree=parse(source),call=deviceCalls(tree)[0];
  assert.ok(call);
  assert.equal(call.x.getText(tree),'10');
  assert.equal(patchDeviceProperties(source,'PT-01',{x:50,label:'Outlet'}),source.replace('x:10','x:50').replace("'Inlet'",'"Outlet"'));
  assert.deepEqual(dslCatalog({'project.ts':source}),[{kind:'equipment.label',id:'PT-01',path:'project.ts',value:'Inlet'}]);
});

test('inspector never inserts an override for computed or shorthand properties', () => {
  for (const fields of ["...defaults,x:10,y:20","label,x:10,y:20","get label(){return name;},x:10,y:20"]) {
    assert.throws(()=>patchDeviceProperties(instance(fields),'PT-01',{label:'Changed'}),denied);
  }
  for (const patch of [{system:null},{z:10}] as const) {
    assert.throws(()=>patchDeviceProperties(instance("...defaults,label:'Inlet',x:10,y:20"),'PT-01',patch),denied);
  }
});

test('duplicate labels and shadowed localized values are read-only', () => {
  for (const label of ["label:'First',label:'Last'","label:{ru:'First',ru:'Last'}","label:{ru:'First',...translations}"]) {
    const source=instance(`${label},x:10,y:20`);
    assert.throws(()=>patchDeviceProperties(source,'PT-01',{label:'Changed'}),denied);
    assert.equal(dslCatalog({'equipment/PT-01.device.ts':source}).some(t=>t.kind==='equipment.label'),false);
  }
});

test('explicit localized override after translations remains editable', () => {
  const source=instance("label:{...translations,ru:'Inlet'},x:10,y:20");
  assert.equal(patchDeviceProperties(source,'PT-01',{label:'Outlet',locale:'ru'}),source.replace("'Inlet'",'"Outlet"'));
  assert.deepEqual(dslCatalog({'project.ts':source}),[{kind:'equipment.label',id:'PT-01',path:'project.ts',locale:'ru',value:'Inlet'}]);
  assert.throws(()=>patchDeviceProperties(source,'PT-01',{label:'Outlet',locale:'en'}),denied);
});

test('a shadowed signal field is not writable through a source proposal', () => {
  for (const fields of [
    "label:'Inlet',x:10,y:20,value:signal({initial:1}),...defaults",
    "label:'Inlet',x:10,y:20,value:signal({initial:1}),value:other",
    "value:signal({initial:1}),...defaults,label:'Inlet',x:10,y:20",
  ]) assert.equal(dslCatalog({'equipment/PT-01.device.ts':instance(fields)}).some(t=>t.kind==='signal.initial'),false);
});

test('mount handles follow the same inverse-edit property rules', () => {
  const good=parse(instance("label:'Inlet',x:10,y:20,mount:mount(panel,{...defaults,x:5,y:6})"));
  const goodCall=deviceCalls(good)[0];assert.ok(goodCall);
  assert.equal(mountCoordinates(goodCall,good)?.x.getText(good),'5');
  for(const mount of ['{x:5,y:6,...defaults}','mount(panel,{x:5,y:6,...defaults})','{x:5,y:6,x:7}']) {
    const tree=parse(instance(`label:'Inlet',x:10,y:20,mount:${mount}`)),call=deviceCalls(tree)[0];assert.ok(call);
    assert.equal(mountCoordinates(call,tree),undefined);
  }
});

test('protected code and noncanonical paths do not gain proposal authority', () => {
  for (const path of ['plugins/vendor/project.ts','firmware/project.ts','targets/project.ts','node_modules/project.ts','protocols/line.ts','tests/line.ts','scripts/line.ts','line.test.ts','line.spec.ts','types.d.ts','server.ts','browser.ts','driver.ts','../project.ts','/project.ts','equipment/../project.ts','equipment\\project.ts','.github/project.ts','equipment//project.ts']) {
    assert.deepEqual(dslCatalog({[path]:instance()}),[],path);
  }
});

test('ambiguous declarations and bounded proposal validation remain fail-closed', () => {
  const files={'project.ts':instance(),'systems/copy.ts':instance()};
  assert.throws(()=>applyDslProposal(files,[{kind:'equipment.label',id:'PT-01',value:'Changed'}]),/ambiguous/);
  assert.throws(()=>applyDslProposal({'project.ts':instance()},[]),/1–8/);
  assert.throws(()=>applyDslProposal({'project.ts':instance()},[{kind:'signal.initial',id:'PT-01.value',value:'bad'}]),/Invalid/);
  assert.throws(()=>applyDslProposal({'project.ts':instance()},[{kind:'signal.initial',id:'PT-01.value',value:Infinity}]),/Invalid/);
  assert.throws(()=>applyDslProposal({'project.ts':instance()},Array.from({length:9},()=>({kind:'equipment.label' as const,id:'PT-01',value:'Changed'}))),/1–8/);
});

test('Workspace indexes the same custom instance and preserves file CAS after an inspector edit', () => {
  const root=mkdtempSync(join(tmpdir(),'saturn-abstraction-'));
  try {
    mkdirSync(join(root,'systems'));
    const source=instance(),path='systems/line.ts';
    writeFileSync(join(root,path),source);
    writeFileSync(join(root,'project.ts'),"export {inlet} from './systems/line';\n");
    const workspace=new Workspace(root),file=workspace.read(path),positions=workspace.positions(['PT-01']);
    assert.equal(positions['PT-01']?.path,path);
    assert.equal(source.slice(positions['PT-01']!.x.from,positions['PT-01']!.x.to),'10');
    const edited=patchDeviceProperties(file.source,'PT-01',{x:100,label:'Outlet'});
    const saved=workspace.save(path,edited,file.version);
    assert.notEqual(saved.version,file.version);
    assert.throws(()=>workspace.save(path,source,file.version),/changed on disk/);
    const next=workspace.positions(['PT-01'])['PT-01'];assert.ok(next);
    assert.equal(saved.source.slice(next.x.from,next.x.to),'100');
    assert.equal(dslCatalog({[path]:saved.source}).find(t=>t.kind==='equipment.label')?.value,'Outlet');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

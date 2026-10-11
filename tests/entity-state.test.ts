import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarm, project, pump, signal, type Snapshot } from '../src/core';
import type { ProjectResource } from '../src/core/resources';
import { entityState, sourceState } from '../src/shell/model/entity-state';
import type { DocumentBuffer } from '../src/shell/model/documents';

const equipment=pump('P-01',{label:'Pump',x:0,y:0,rpm:signal({initial:0})});
const model=project({id:'test',label:'Test',equipment:[equipment],pipes:[],alarms:[alarm('rpm-high',{label:'High speed',signal:equipment.rpm,above:100})]});
const resource:ProjectResource={uri:'saturn://test/device/P-01',kind:'device',entityId:'P-01',name:{en:'Pump',ru:'Насос'},icon:'pump',editors:['diagram','source'],source:{path:'equipment/pump.ts'},related:[]};
const buffer:DocumentBuffer={path:'equipment/pump.ts',source:'saved',draft:'draft',version:'1',saving:false};
const observations:Snapshot={samples:{},alarms:{'rpm-high':{id:'rpm-high',active:true,acknowledged:false,at:1}}};
test('active object alarm remains visible while its source is dirty, saving or failed',()=>{
  for(const authored of [buffer,{...buffer,saving:true},{...buffer,error:'Save failed'}]){
    const documents=new Map([[buffer.path,authored]]);
    assert.equal(entityState(resource,documents,model,observations,true,[]),'alarm');
    assert.equal(sourceState(resource,documents,[]),authored.error?'error':authored.saving?'saving':'modified');
  }
});
test('object connection/freshness and file draft are independent projections',()=>{
  const documents=new Map([[buffer.path,buffer]]),snapshot:Snapshot={samples:{},alarms:{}};
  assert.equal(entityState(resource,documents,model,snapshot,false,[]),'offline');
  assert.equal(entityState(resource,documents,model,snapshot,true,[]),'stale');
  assert.equal(entityState(resource,documents,model,snapshot,false,[],'source'),'modified');
});
test('an authored device missing from Applied has no invented observation status',()=>{
  assert.equal(entityState({...resource,entityId:'NEW'},new Map(),model,observations,true,[]),'pending');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarm, cable, column, command, observation, pipe, plc, project, pump, report, signal, tank, valve, type ReportRow, type Sample, type Snapshot } from '../src/core';
import { routeConnection, routeConnections } from '../src/topology';
import { aggregateReport, reportCsv } from '../src/reports';
import { advancePhase, flowOf } from '../src/motion';
const s={rpm:signal('rpm',{initial:0}),flow:signal('flow',{initial:0,unit:'m³/h',staleAfter:3600_000}),run:signal('run',{initial:true,writable:true}),level:signal('level',{initial:50}),opening:signal('opening',{initial:75}),online:signal('online',{initial:true})};
const tk=tank('TK',{label:'Tank',x:0,y:0,level:s.level}),p=pump('P',{label:'Pump',x:300,y:70,rpm:s.rpm,run:s.run}),v=valve('V',{label:'Valve',x:650,y:0,opening:s.opening}),ctrl=plc('PLC',{label:'PLC',x:650,y:300,online:s.online});
const r=report('water',{label:'Water',bucketMs:3600_000,columns:{volume:column(s.flow,'integral','Volume','m³'),mean:column(s.flow,'mean','Mean'),last:column(s.run,'last','Running')}});
const model=project({id:'test',label:'test',signals:s,equipment:[tk,p,v,ctrl],pipes:[pipe('a',{from:tk.ports.outlet,to:p.ports.inlet,flow:s.flow}),pipe('b',{from:p.ports.outlet,to:v.ports.inlet,flow:s.flow})],cables:[cable('c',{from:ctrl.ports.DO1,to:p.ports.run,signal:s.run})],alarms:[alarm('high',{label:'high',signal:s.flow,above:10})],reports:[r]});
// These must fail the compiler. A passing runtime test alone cannot prove inference.
if(false){
  const id:'rpm'=model.signals.rpm.id;
  const equipmentSignal:'rpm'=p.rpm.id;
  const portName:'outlet'=p.ports.outlet.port;
  void [equipmentSignal,portName];
  const n:number|undefined=observation({samples:{},alarms:{}},model.signals.rpm)?.value;
  const row:ReportRow<typeof r>={from:0,to:1,values:{volume:2,mean:2,last:true}};
  void [id,n,row];
  // @ts-expect-error Preserve known signal keys.
  model.signals.missing;
  // @ts-expect-error Command value must be boolean.
  command(s.run,1);
  // @ts-expect-error Read-only signals reject commands.
  command(s.rpm,5);
  // @ts-expect-error Fluid and control ports cannot connect.
  cable('bad',{from:ctrl.ports.DO1,to:v.ports.inlet});
  // @ts-expect-error Different electrical families cannot connect.
  cable('bad',{from:ctrl.ports.DO1,to:v.ports.command});
  // @ts-expect-error Input cannot be used as a pipe source.
  pipe('bad',{from:p.ports.inlet,to:v.ports.inlet,flow:s.flow});
  // @ts-expect-error Numeric aggregation rejects booleans.
  column(s.run,'mean','No');
}
test('routes preserve terminal xyz and orthogonality',()=>{
  for(const route of routeConnections(model)){
    assert.equal(route.valid,true,route.id+':'+route.error);
    for(let i=1;i<route.points.length;i++){const a=route.points[i-1]!,b=route.points[i]!;assert.equal([a.x!==b.x,a.y!==b.y,a.z!==b.z].filter(Boolean).length,1);}
  }
  const route=routeConnection(model,model.pipes[0]!);
  assert.deepEqual(route.points[0],{x:170,y:184,z:24});assert.deepEqual(route.points.at(-1),{x:300,y:166,z:60});
});
test('routing changes while moving, avoids obstacles, and reports blocked stubs',()=>{
  const original=routeConnection(model,model.pipes[0]!);
  const moved={...model,equipment:model.equipment.map(e=>e.id==='P'?{...e,x:410}:e)};
  assert.notDeepEqual(routeConnection(moved,model.pipes[0]!).points,original.points);
  const blocked={...model,equipment:[...model.equipment,plc('obstacle',{label:'O',x:175,y:140,online:s.online})]};
  assert.equal(routeConnection(blocked,model.pipes[0]!).valid,false);
});
test('runtime validation rejects forged ports and double occupancy',()=>{
  assert.throws(()=>project({...model,cables:[{...model.cables[0]!,to:v.ports.command}]}),/Incompatible/);
  assert.throws(()=>project({...model,pipes:[...model.pipes,{...model.pipes[0]!,id:'occupied'}]}),/occupied/);
});
const sample=(at:number,value:number,quality:Sample['quality']='good'):Sample=>({at,value,quality,signal:'flow'});
test('time-weighted report: 10 m³/h for 30min plus 20 for 30min = 15 m³',()=>{
  const result=aggregateReport(r,new Map([['flow',[sample(0,10),sample(1800_000,20)]]]),0,3600_000);
  assert.equal(result.rows[0]!.values.volume,15);assert.equal(result.rows[0]!.values.mean,15);assert.equal(result.rows[0]!.coverage.volume,1);assert.equal(result.rows[0]!.values.last,null);
});
test('gaps have coverage, no data is null, bad data stops integration',()=>{
  const short=report('short',{...r,columns:{v:column({...s.flow,staleAfter:1000},'integral','V')}});
  const result=aggregateReport(short,new Map([['flow',[sample(0,3600),sample(500,999,'bad')]]]),0,3600_000);
  assert.equal(result.rows[0]!.values.v,.5);assert.equal(result.rows[0]!.coverage.v,500/3600_000);
  assert.equal(aggregateReport(short,new Map(),0,3600_000).rows[0]!.values.v,null);
});
test('buckets clip a preceding observation, partial last window, and limits',()=>{
  const result=aggregateReport(r,new Map([['flow',[sample(0,10),sample(3600_000,20)]]]),1800_000,5400_000);
  assert.equal(result.rows[0]!.values.volume,15);
  const partial=aggregateReport(r,new Map([['flow',[sample(0,10),sample(3600_000,20)]]]),0,5400_000);
  assert.equal(partial.rows.length,2);assert.equal(partial.rows[1]!.to,5400_000);assert.equal(partial.rows[1]!.values.volume,10);
  assert.throws(()=>aggregateReport(r,new Map(),0,40*86400_000));
});
test('CSV quotes content and prevents spreadsheet formulas',()=>{
  const unsafe=report('unsafe',{label:'test',bucketMs:1000,columns:{x:column(signal('string',{initial:''}),'last','=HYPERLINK("bad")')}});
  const result=aggregateReport(unsafe,new Map([['string',[{signal:'string',at:0,value:'=1+1',quality:'good'}]]]),0,1000);
  assert.ok(reportCsv(result,'en').includes("'=1+1"));assert.ok(reportCsv(result,'en').includes("'=HYPERLINK"));
});
test('motion integrates phase; a closed valve and stale flow stop the flow',()=>{
  assert.ok(Math.abs(advancePhase(.2,1,.1)-.3)<1e-9);assert.ok(Math.abs(advancePhase(.3,-1,.1)-.2)<1e-9);
  const snapshot:Snapshot={samples:{flow:{signal:'flow',value:10,quality:'good',at:1000},opening:{signal:'opening',value:0,quality:'good',at:1000}},alarms:{}};
  assert.equal(flowOf(model.pipes[1]!,model,snapshot,1100),0);
  snapshot.samples.flow!.quality='stale';assert.equal(flowOf(model.pipes[1]!,model,snapshot,1100),null);
});

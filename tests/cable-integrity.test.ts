import {test,expect} from 'bun:test';
import {cable,plc,pump,project,signal,validateProject,diagnoseCableIntegrity,free,type Snapshot,type CableDigitalPathMonitor} from '../src/core';
import {canonical} from '../src/core/artifact';
import {decodeProject} from '../src/core/project-codec';
import {semanticGraph} from '../src/semantic';
const now=1_000_000;
const source=signal('PLC.output',{initial:false,staleAfter:1000});
const destination=signal('P.input',{initial:false,staleAfter:1000});
const deviceA=plc('PLC',{label:'PLC',x:0,y:0});
const deviceB=pump('P',{label:'Pump',x:600,y:0});
const link=cable('control-01',{from:deviceA.ports.DO1,to:deviceB.ports.run,
  integrity:{kind:'digital-path',source,destination,maxSkewMs:200}});
const plant=project({id:'p',label:'P',equipment:[deviceA,deviceB],cables:[link],alarms:[]});
const readings=(a:boolean,b:boolean,opts:{at?:number;atB?:number;quality?:'good'|'stale'|'bad'|'offline';substituted?:boolean}={}):Snapshot=>({
  samples:{
    [source.id]:{signal:source.id,value:a,quality:opts.quality??'good',at:opts.at??now,receivedAt:opts.at??now},
    [destination.id]:{signal:destination.id,value:b,quality:opts.quality??'good',at:opts.atB??opts.at??now,receivedAt:opts.atB??opts.at??now,state:opts.substituted?{substituted:true,validity:'good',connection:'online',freshness:'fresh'}:undefined}
  },alarms:{},
});
const evaluate=(s:Snapshot,connected=true)=>diagnoseCableIntegrity(plant,s,{now,connected})[0]!;
test('digital cable observations are collected, validated, and survive transport as shared Signals',()=>{
  validateProject(plant);
  expect(Object.keys(plant.signals)).toContain(source.id);
  expect(Object.keys(plant.signals)).toContain(destination.id);
  const decoded=decodeProject(canonical(plant));
  expect(decoded.cables![0]!.integrity!.source===decoded.signals[source.id]).toBe(true);
  expect(decoded.cables![0]!.integrity!.destination===decoded.signals[destination.id]).toBe(true);
  const graph=semanticGraph(plant).bySemanticId.get('connection:control-01')!;
  expect(graph.uses).toContain('signal:'+source.id);
  expect(graph.uses).toContain('signal:'+destination.id);
});
test('only independently observed mismatch marks suspect; inactive is NOT healthy',()=>{
  expect(evaluate(readings(true,false))).toMatchObject({state:'suspected',reason:'lost-signal'});
  expect(evaluate(readings(false,true))).toMatchObject({state:'suspected',reason:'unexpected-high'});
  expect(evaluate(readings(true,true))).toMatchObject({state:'observed',reason:'propagated'});
  expect(evaluate(readings(false,false))).toMatchObject({state:'inactive',reason:'not-excited'});
});
test('fails closed on quality, time, provenance, disconnect and missing measurements',()=>{
  expect(evaluate({samples:{},alarms:{}}).reason).toBe('missing');
  expect(evaluate(readings(true,false,{at:now-2000})).reason).toBe('unhealthy');
  expect(evaluate(readings(true,false),false).reason).toBe('unhealthy');
  expect(evaluate(readings(true,false,{quality:'offline'})).state).toBe('unavailable');
  expect(evaluate(readings(true,false,{substituted:true})).reason).toBe('substituted');
  expect(evaluate(readings(true,false,{atB:now-500})).reason).toBe('unsynchronized');
  const historical=readings(true,false);
  historical.samples[source.id]!.provenance={id:'a',build:'x',sourceRevision:null,mode:'simulation',startedAt:now};
  historical.samples[destination.id]!.provenance={id:'b',build:'x',sourceRevision:null,mode:'simulation',startedAt:now};
  expect(evaluate(historical).reason).toBe('different-run');
  const broken={...plant,cables:[{...link,to:free(deviceB.ports.run,{x:400,y:50,z:0})}]};
  expect(diagnoseCableIntegrity(broken,readings(true,false),{now})[0]).toMatchObject({state:'unavailable',reason:'disconnected'});
  expect(diagnoseCableIntegrity({...plant,cables:[{...link,integrity:undefined}]},readings(true,false),{now})[0]).toMatchObject({state:'unmonitored',reason:'no-monitor'});
});
test('reuse of one pair cannot implicate two cables',()=>{
  const duplicate={...plant,cables:[...plant.cables!,{...plant.cables![0]!,id:'control-02'}]};
  expect(diagnoseCableIntegrity(duplicate,readings(true,false),{now}).every(f=>f.reason==='duplicate-pair')).toBe(true);
  expect(()=>validateProject(duplicate)).toThrow();
});
test('invalid monitor contracts never enter checked Project',()=>{
  const invalid=(monitor:CableDigitalPathMonitor)=>({...plant,cables:[{...link,integrity:monitor}]});
  const m=link.integrity;
  expect(()=>validateProject(invalid({...m,source:destination}))).toThrow();
  expect(()=>validateProject(invalid({...m,destination:signal('num',{initial:1}) as never}))).toThrow();
  expect(()=>validateProject(invalid({...m,maxSkewMs:0}))).toThrow();
  expect(()=>validateProject(invalid({...m,source:signal('cmd',{initial:true,writable:true})}))).toThrow();
});
test('ordinary unmonitored cables retain existing typed project signal inference',()=>{
  const command=signal('pump.command',{initial:false,writable:true});
  const noMonitor=project({id:'control',label:'C',equipment:[deviceA,deviceB],cables:[
    cable('command',{from:deviceA.ports.DO1,to:deviceB.ports.run,signal:command}),
  ],alarms:[]});
  if(false){
    const id:'pump.command'=noMonitor.signals['pump.command'].id;
    void id;
    // @ts-expect-error Unknown signal keys do not exist on literal project models
    noMonitor.signals['unknown-signal'];
  }
  expect(noMonitor.signals[command.id]).toBe(command);
});

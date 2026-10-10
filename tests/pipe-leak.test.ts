import {test,expect} from 'bun:test';
import {pipe,project,pump,tank,signal,diagnosePipeLeaks,validateProject,type Snapshot,type PipeLeakMonitor} from '../src/core';
import {canonical} from '../src/core/artifact';
import {decodeProject} from '../src/core/project-codec';
import {semanticGraph} from '../src/semantic';

const now=1_000_000;
const inlet=signal('segment.in',{initial:0,unit:'m³/h',dimension:'flow',staleAfter:1000});
const outlet=signal('segment.out',{initial:0,unit:'m³/h',dimension:'flow',staleAfter:1000});
const a=tank('TK',{label:'Tank',x:0,y:0}),b=pump('P',{label:'Pump',x:500,y:0});
const station=project({
  id:'station',label:'Station',equipment:[a,b],alarms:[],
  pipes:[pipe('segment',{from:a.ports.outlet,to:b.ports.inlet,flow:inlet,leak:{inlet,outlet,maxLoss:0.4,maxSkewMs:200}})],
});
const readings=(inFlow:number,outFlow:number,opts:{at?:number;outAt?:number;quality?:'good'|'stale'|'bad'|'offline';substituted?:boolean}={}):Snapshot=>({
  samples:{
    [inlet.id]:{signal:inlet.id,value:inFlow,at:opts.at??now,receivedAt:opts.at??now,quality:opts.quality??'good'},
    [outlet.id]:{signal:outlet.id,value:outFlow,at:opts.outAt??opts.at??now,receivedAt:opts.outAt??opts.at??now,quality:opts.quality??'good',state:opts.substituted?{substituted:true,validity:'good',connection:'online',freshness:'fresh'}:undefined},
  },alarms:{},
});
const evaluate=(sample:Snapshot,connected=true)=>diagnosePipeLeaks(station,sample,{now,connected})[0]!;
test('meter pair is collected, typed and survives artifact round trip',()=>{
  validateProject(station);
  expect(Object.keys(station.signals)).toContain(inlet.id);
  expect(Object.keys(station.signals)).toContain(outlet.id);
  const decoded=decodeProject(canonical(station));
  expect(decoded.pipes[0]!.leak!.inlet===decoded.signals[inlet.id]).toBe(true);
  expect(decoded.pipes[0]!.leak!.outlet===decoded.signals[outlet.id]).toBe(true);
  const graph=semanticGraph(station);
  const pipeNode=graph.bySemanticId.get('connection:segment')!;
  expect(pipeNode.uses).toContain('signal:'+inlet.id);
  expect(pipeNode.uses).toContain('signal:'+outlet.id);
});
test('compares only two fresh, synchronized measurements on the same pipe',()=>{
  expect(evaluate(readings(10,8)).state).toBe('suspected');
  expect(evaluate(readings(10,8)).difference).toBe(2);
  expect(evaluate(readings(10,9.8)).state).toBe('normal');
  expect(evaluate(readings(10,12)).reason).toBe('reverse-flow');
});
test('never localizes from stale, missing, offline, substituted or mismatched data',()=>{
  expect(evaluate({samples:{},alarms:{}}).reason).toBe('missing');
  expect(evaluate(readings(10,8,{at:now-2000})).state).toBe('unavailable');
  expect(evaluate(readings(10,8),false).state).toBe('unavailable');
  expect(evaluate(readings(10,8,{quality:'bad'})).reason).toBe('unhealthy');
  expect(evaluate(readings(10,8,{outAt:now-400})).reason).toBe('unsynchronized');
  expect(evaluate(readings(10,8,{substituted:true})).reason).toBe('substituted');
  const inconsistent=readings(10,8);
  inconsistent.samples[outlet.id]!.provenance={id:'old',build:'build',sourceRevision:null as never,mode:'simulation',startedAt:now} as never;
  expect(evaluate(inconsistent).reason).toBe('different-run');
});
test('uninstrumented pipe is explicitly unknown, not marked normal',()=>{
  const without={...station,pipes:[{...station.pipes[0]!,leak:undefined}]};
  expect(diagnosePipeLeaks(without,readings(10,0),{now})[0]).toMatchObject({state:'unmonitored',reason:'no-meters'});
});
test('invalid meter contracts are rejected at source validation',()=>{
  const original=station.pipes[0]!;
  const invalid=(leak:PipeLeakMonitor)=>({...station,pipes:[{...original,leak}]});
  expect(()=>validateProject(invalid({...original.leak!,outlet:inlet}))).toThrow();
  expect(()=>validateProject(invalid({...original.leak!,maxLoss:0}))).toThrow();
  expect(()=>validateProject(invalid({...original.leak!,outlet:{...outlet,unit:'L/s'}}))).toThrow();
});

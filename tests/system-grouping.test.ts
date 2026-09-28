import { expect, test } from 'bun:test';
import { device, project, ProjectError, system } from '../src/core';
import { systemLayout, systemTitleLines } from '../src/core/system-layout';
import { createArtifact, digest } from '../src/core/artifact';
import { decodeProject } from '../src/core/project-codec';
import { semanticDiff } from '../src/semantic';

const bank=device({id:'group-bank',icon:'bank',ports:{}});
const source=()=>project({
  id:'group-test',label:'Grouped installation',
  systems:[system('site','Site'),system('water','Water system','site'),system('power','Power system','site')],
  equipment:[bank('W1',{label:'Pump room',system:'water',x:120,y:180}),bank('P1',{label:'Switchgear',system:'power',x:760,y:180})],
  pipes:[],
});

test('authored installation hierarchy survives BuildArtifact and keeps its equipment membership',async()=>{
  const model=source();
  const hash=await digest('group-test');
  const artifact=await createArtifact(model,null,{sourceRevision:null,sourceDigest:hash,coreHash:hash,lockHash:null,bunVersion:Bun.version});
  const decoded=decodeProject(artifact.model);
  expect(decoded.systems).toEqual(model.systems);
  expect(decoded.equipment.map(e=>[e.id,e.system])).toEqual([['W1','water'],['P1','power']]);
});

test('nested system plates contain equipment and recompute after an authored position change',()=>{
  const model=source(),before=systemLayout(model);
  const site=before.find(g=>g.id==='site')!,water=before.find(g=>g.id==='water')!,power=before.find(g=>g.id==='power')!;
  expect(site.count).toBe(2);expect(water.count).toBe(1);expect(power.count).toBe(1);
  const contains=(outer:typeof site,inner:{x:number;y:number;width:number;height:number})=>outer.x<=inner.x&&outer.y<=inner.y&&outer.x+outer.width>=inner.x+inner.width&&outer.y+outer.height>=inner.y+inner.height;
  expect(contains(site,water)).toBe(true);expect(contains(site,power)).toBe(true);
  expect(contains(water,{x:model.equipment[0]!.x,y:model.equipment[0]!.y,width:160,height:150})).toBe(true);
  expect(model.equipment[0]!.y-48).toBeGreaterThanOrEqual(water.y+76);
  const moved={...model,equipment:model.equipment.map(e=>e.id==='W1'?{...e,x:e.x+100}:e)};
  const after=systemLayout(moved);
  expect(after.find(g=>g.id==='water')!.x).toBe(water.x+100);
  expect(after.find(g=>g.id==='power')).toEqual(power);
  expect(source().equipment[0]!.x).toBe(120);
  expect(systemTitleLines('A long physical system with several nested subsystems',214).length).toBeLessThanOrEqual(2);
});

test('missing parents, hierarchy cycles and unknown equipment membership fail at the project boundary',()=>{
  const invalid=(systems:ReturnType<typeof system>[],member='site')=>project({id:'invalid-systems',label:'Invalid',systems,equipment:[bank('B',{label:'Bank',system:member,x:0,y:0})],pipes:[]});
  expect(()=>invalid([system('site','Site','missing')])).toThrow(ProjectError);
  expect(()=>invalid([system('site','Site','child'),system('child','Child','site')])).toThrow(ProjectError);
  expect(()=>invalid([system('site','Site')],'missing')).toThrow(ProjectError);
});

test('semantic review names system and membership changes',()=>{
  const before=source();
  const after=project({...before,systems:[system('site','Site'),system('water','Service water','site'),system('power','Power system','site')],equipment:before.equipment.map(e=>e.id==='W1'?{...e,system:'power'}:e)});
  const changes=semanticDiff(before,after);
  expect(changes.some(change=>change.semanticId==='system:water'&&change.type==='changed')).toBe(true);
  expect(changes.some(change=>change.semanticId==='system:power'&&change.type==='changed')).toBe(true);
  expect(changes.some(change=>change.semanticId==='equipment:W1'&&change.type==='changed')).toBe(true);
});

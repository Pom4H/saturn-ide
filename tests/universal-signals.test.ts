import { expect, test } from 'bun:test';
import demo, { booster } from '../project/project';
import { bind, protocol, qualityState, signal } from '../src/core';
import { projectDocumentation } from '../src/documentation';
import { impact, semanticDiff, semanticGraph } from '../src/semantic';

test('equipment owns anonymous signals without duplicated string paths',()=>{
  expect(booster.rpm.id).toBe('P-01.rpm');
  expect(booster.rpm.owner).toEqual({kind:'equipment',id:'P-01',field:'rpm'});
  expect(booster.rpm.semanticId).toBe('signal:equipment:booster-primary:rpm');
  expect(demo.signals[booster.rpm.id]).toBe(booster.rpm);
  expect(demo.signals[booster.pressure.id]).toBe(booster.pressure);
});

test('transport binding does not change explicit signal identity or value type',()=>{
  const pressure=signal('P-101.pressure',{initial:0,unit:'bar',dimension:'pressure',origin:{kind:'hardware',device:'PT-101'}});
  const modbus=bind(pressure,protocol.modbus('PLC-01',40124,{codec:'float32be'}));
  const opcua=bind(pressure,protocol.opcua('opc.tcp://plant','ns=4;s=P101.Pressure'));
  expect(modbus.id).toBe(pressure.id);expect(opcua.id).toBe(pressure.id);
  expect(modbus.binding?.protocol).toBe('modbus');expect(opcua.binding?.protocol).toBe('opcua');
  const value:number=modbus.initial;expect(value).toBe(0);
});

test('semantic graph exposes blast radius and stable rename identity',()=>{
  const graph=semanticGraph(demo),pump=graph.bySemanticId.get('equipment:booster-primary');
  expect(pump?.id).toBe('P-01');expect(pump?.uses).toContain('signal:equipment:booster-primary:rpm');
  expect(impact(demo,booster.pressure.id)?.transitive.some(node=>node.id==='high-pressure')).toBe(true);
  const renamed={...demo,equipment:demo.equipment.map(e=>e.id==='P-01'?{...e,id:'P-201'}:e)};
  expect(semanticDiff(demo,renamed as typeof demo).some(change=>change.type==='renamed'&&change.semanticId==='equipment:booster-primary')).toBe(true);
});

test('semantic diff includes engineering attributes, not only graph edges',()=>{
  const moved={...demo,equipment:demo.equipment.map(e=>e.id==='P-01'?{...e,x:e.x+25}:e)};
  expect(semanticDiff(demo,moved as typeof demo)).toContainEqual(expect.objectContaining({semanticId:'equipment:booster-primary',type:'changed'}));
  const changedPressure={...demo,signals:{...demo.signals,[booster.pressure.id]:{...booster.pressure,unit:'kPa'}}};
  expect(semanticDiff(demo,changedPressure as typeof demo).some(change=>change.semanticId===booster.pressure.semanticId&&change.type==='changed')).toBe(true);
});

test('compact runtime quality has a richer canonical interpretation',()=>{
  expect(qualityState('good')).toEqual({validity:'good',connection:'online',freshness:'fresh'});
  expect(qualityState('stale').freshness).toBe('stale');expect(qualityState('bad').validity).toBe('bad');
});

test('documentation is bilingual traceability derived from the same project object',()=>{
  const en=projectDocumentation(demo,{locale:'en'}),ru=projectDocumentation(demo,{locale:'ru'});
  expect(en).toContain('# Pumping station');expect(en).toContain('P-01.rpm');expect(en).toContain('equipment:booster-primary');
  expect(en).toContain('Traceability');expect(en).toContain('high-pressure');expect(en).toContain('hourly-water');
  expect(ru).toContain('Трассировка');expect(ru).toContain('Повысительный насос');
});
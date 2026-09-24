import { expect, test } from 'bun:test';
import demo from '../project/project';
import { bind, protocol, qualityState, signal } from '../src/core';
import { projectDocumentation } from '../src/documentation';

test('transport binding does not change signal identity or value type',()=>{
  const pressure=signal('P-101.pressure',{initial:0,unit:'bar',dimension:'pressure',origin:{kind:'hardware',device:'PT-101'}});
  const modbus=bind(pressure,protocol.modbus('PLC-01',40124,{codec:'float32be'}));
  const opcua=bind(pressure,protocol.opcua('opc.tcp://plant','ns=4;s=P101.Pressure'));
  expect(modbus.id).toBe(pressure.id);
  expect(opcua.id).toBe(pressure.id);
  expect(modbus.binding?.protocol).toBe('modbus');
  expect(opcua.binding?.protocol).toBe('opcua');
  const value:number=modbus.initial;
  expect(value).toBe(0);
});

test('compact runtime quality has a richer canonical interpretation',()=>{
  expect(qualityState('good')).toEqual({validity:'good',connection:'online',freshness:'fresh'});
  expect(qualityState('stale').freshness).toBe('stale');
  expect(qualityState('bad').validity).toBe('bad');
});

test('documentation is derived from the same project object',()=>{
  const markdown=projectDocumentation(demo,{locale:'en'});
  expect(markdown).toContain('# Pumping station');
  expect(markdown).toContain('pump.rpm');
  expect(markdown).toContain('P-01');
  expect(markdown).toContain('high-pressure');
  expect(markdown).toContain('hourly-water');
  expect(markdown).toContain('typed Signal<T>');
});

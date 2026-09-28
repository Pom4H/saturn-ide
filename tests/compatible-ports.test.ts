import { test } from 'node:test';
import assert from 'node:assert/strict';
import demo from '@saturn/example';
import { cable, device, free, pipe, project, signal, terminal, type Project } from '../src/core';
import { compatiblePorts } from '../src/shell/model/compatible-ports';
import { densePortProject, fullValidationPorts } from '../scripts/compatible-ports-benchmark';

const ids = (ports: { device: string; port: string }[]) => ports.map(port => `${port.device}.${port.port}`);

function variedPortProject(): Project {
  const make = device({ id: 'fixture', icon: 'fixture', ports: {
    fluidOut: terminal({ x: 0, y: 0, z: 0, side: 'up', medium: 'fluid', family: 'water', role: 'source', unit: 'L/s' }),
    fluidOutBusy: terminal({ x: 10, y: 0, z: 0, side: 'up', medium: 'fluid', family: 'water', role: 'source', unit: 'L/s' }),
    fluidOutOil: terminal({ x: 20, y: 0, z: 0, side: 'up', medium: 'fluid', family: 'oil', role: 'source', unit: 'L/s' }),
    fluidOutUnit: terminal({ x: 30, y: 0, z: 0, side: 'up', medium: 'fluid', family: 'water', role: 'source', unit: '%' }),
    fluidIn: terminal({ x: 40, y: 0, z: 0, side: 'up', medium: 'fluid', family: 'water', role: 'sink', unit: 'L/s', max: 2 }),
    controlOut: terminal({ x: 50, y: 0, z: 0, side: 'up', medium: 'control', family: 'digital', role: 'source', valueType: 'boolean' }),
    controlOutBusy: terminal({ x: 60, y: 0, z: 0, side: 'up', medium: 'control', family: 'digital', role: 'source', valueType: 'boolean' }),
    controlOutNumber: terminal({ x: 70, y: 0, z: 0, side: 'up', medium: 'control', family: 'digital', role: 'source', valueType: 'number' }),
    controlOutUnit: terminal({ x: 80, y: 0, z: 0, side: 'up', medium: 'control', family: 'digital', role: 'source', valueType: 'boolean', unit: 'V' }),
    controlOutAnalog: terminal({ x: 90, y: 0, z: 0, side: 'up', medium: 'control', family: 'analog', role: 'source', valueType: 'boolean' }),
    controlIn: terminal({ x: 100, y: 0, z: 0, side: 'up', medium: 'control', family: 'digital', role: 'sink', valueType: 'boolean', max: 2 }),
    bus: terminal({ x: 110, y: 0, z: 0, side: 'up', medium: 'bus', family: 'rs485', role: 'passive', max: 2 }),
  } });
  const a = make('A', { label: 'A', x: 0, y: 0 });
  const b = make('B', { label: 'B', x: 200, y: 0 });
  const c = make('C', { label: 'C', x: 400, y: 0 });
  const d = make('D', { label: 'D', x: 600, y: 0 });
  const water = signal('water', { initial: 0 });
  const water2 = signal('water2', { initial: 0 });
  const water3 = signal('water3', { initial: 0 });
  const run = signal('run', { initial: false });
  return project({
    id: 'varied-ports', label: 'Varied ports', equipment: [a, b, c, d],
    pipes: [
      pipe('fluid', { from: a.ports.fluidOut, to: b.ports.fluidIn, flow: water }),
      pipe('fluid-busy', { from: c.ports.fluidOutBusy, to: d.ports.fluidIn, flow: water2 }),
      pipe('fluid-loose', { from: free(a.ports.fluidOut, { x: 50, y: 200, z: 0 }), to: d.ports.fluidIn, flow: water3 }),
    ],
    cables: [
      cable('control', { from: a.ports.controlOut, to: b.ports.controlIn, signal: run }),
      cable('control-busy', { from: c.ports.controlOutBusy, to: d.ports.controlIn, signal: run }),
      cable('control-loose', { from: free(a.ports.controlOut, { x: 50, y: 250, z: 0 }), to: b.ports.controlIn, signal: run }),
      cable('bus', { from: a.ports.bus, to: c.ports.bus }),
    ], alarms: [],
  });
}

test('connection drag offers only ports accepted by the authored project', () => {
  const before = JSON.stringify(demo);
  const eligible = compatiblePorts(demo, 'run-command', 'from').map(port => `${port.device}.${port.port}`);
  assert.deepEqual(eligible, ['PLC-01.DO1', 'PLC-01.DO2']);
  assert.equal(JSON.stringify(demo), before);
});

test('dense port candidates match full validation at the authored device limit', () => {
  const model = densePortProject();
  const before = JSON.stringify(model);
  for (const end of ['from', 'to'] as const) {
    assert.deepEqual(ids(compatiblePorts(model, 'move', end)), ids(fullValidationPorts(model, 'move', end)));
  }
  assert.equal(JSON.stringify(model), before);
});

test('pipes, cables and free ends match full validation across capacity, quantity and direction', () => {
  const model = variedPortProject();
  for (const id of ['fluid', 'fluid-busy', 'fluid-loose', 'control', 'control-busy', 'control-loose', 'bus']) {
    for (const end of ['from', 'to'] as const) {
      assert.deepEqual(ids(compatiblePorts(model, id, end)), ids(fullValidationPorts(model, id, end)), `${id}.${end}`);
    }
  }
  const fluid = ids(compatiblePorts(model, 'fluid', 'from'));
  assert(fluid.includes('C.fluidOut'));
  for (const rejected of ['B.fluidOut', 'C.fluidOutBusy', 'C.fluidOutOil', 'C.fluidOutUnit', 'C.fluidIn', 'C.controlOut']) assert(!fluid.includes(rejected), rejected);
  const control = ids(compatiblePorts(model, 'control', 'from'));
  assert(control.includes('C.controlOut'));
  for (const rejected of ['B.controlOut', 'C.controlOutBusy', 'C.controlOutNumber', 'C.controlOutUnit', 'C.controlOutAnalog', 'C.controlIn']) assert(!control.includes(rejected), rejected);
});

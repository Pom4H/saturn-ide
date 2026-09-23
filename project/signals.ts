import { signal } from '@saturn/core';
export const signals = {
  run: signal('pump.run', { initial: true, writable: true }),
  rpm: signal('pump.rpm', { initial: 0, unit: 'rpm', min: 0, max: 3000 }),
  level: signal('tank.level', { initial: 64, unit: '%', min: 0, max: 100 }),
  opening: signal('valve.opening', { initial: 75, unit: '%', writable: true, min: 0, max: 100 }),
  flow: signal('station.flow', { initial: 0, unit: 'm³/h', min: 0 }),
  pressure: signal('station.pressure', { initial: 0, unit: 'bar', min: 0 }),
  online: signal('plc.online', { initial: false }),
};

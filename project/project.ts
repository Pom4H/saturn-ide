import { alarm, cable, column, pipe, plc, project, pump, report, signal, tank, valve } from '@saturn/core';

export const signals = {
  run: signal('pump.run', { initial: true, writable: true }),
  rpm: signal('pump.rpm', { initial: 0, unit: 'rpm', min: 0, max: 3000 }),
  level: signal('tank.level', { initial: 64, unit: '%', min: 0, max: 100 }),
  opening: signal('valve.opening', { initial: 75, unit: '%', writable: true, min: 0, max: 100 }),
  flow: signal('station.flow', { initial: 0, unit: 'm³/h', min: 0 }),
  pressure: signal('station.pressure', { initial: 0, unit: 'bar', min: 0 }),
  online: signal('plc.online', { initial: false }),
};

const reservoir = tank('TK-01', {
  label: { en: 'Supply tank', ru: 'Питающий резервуар' },
  x: 60, y: 65, level: signals.level,
});
const booster = pump('P-01', {
  label: { en: 'Booster pump', ru: 'Повысительный насос' },
  x: 335, y: 190, rpm: signals.rpm, run: signals.run,
});
const outlet = valve('V-01', {
  label: { en: 'Outlet valve', ru: 'Выходной клапан' },
  x: 660, y: 65, opening: signals.opening,
});
const controller = plc('PLC-01', {
  label: { en: 'Station controller', ru: 'Контроллер станции' },
  x: 670, y: 335, online: signals.online,
});

export default project({
  id: 'pumping-station',
  label: { en: 'Pumping station', ru: 'Насосная станция' },
  signals,
  equipment: [reservoir, booster, outlet, controller],
  hmi: { width: 320, height: 240, equipment: [reservoir, booster, outlet] },
  pipes: [
    pipe('suction', { from: reservoir.ports.outlet, to: booster.ports.inlet, flow: signals.flow }),
    pipe('discharge', { from: booster.ports.outlet, to: outlet.ports.inlet, flow: signals.flow }),
  ],
  cables: [
    cable('run-command', { from: controller.ports.DO1, to: booster.ports.run, signal: signals.run }),
    cable('valve-command', { from: controller.ports.AO1, to: outlet.ports.command, signal: signals.opening }),
  ],
  alarms: [alarm('high-pressure', {
    label: { en: 'High discharge pressure', ru: 'Высокое давление на выходе' },
    signal: signals.pressure, above: 4.5, hysteresis: 0.25,
  })],
  reports: [report('hourly-water', {
    label: { en: 'Hourly water balance', ru: 'Почасовой расход воды' },
    bucketMs: 3600_000,
    columns: {
      volume: column(signals.flow, 'integral', { en: 'Volume', ru: 'Объём' }, 'm³'),
      meanFlow: column(signals.flow, 'mean', { en: 'Mean flow', ru: 'Средний расход' }, 'm³/h'),
      peakPressure: column(signals.pressure, 'max', { en: 'Peak pressure', ru: 'Макс. давление' }, 'bar'),
    },
  })],
});

import { alarm, cable, pipe, project } from '@saturn/core';
import reservoir from './equipment/TK-01.device';
import booster from './equipment/P-01.device';
import outlet from './equipment/V-01.device';
import controller from './equipment/PLC-01.device';
import hourlyWater from './reports/hourly-water.report';

export { reservoir, booster, outlet, controller };
export default project({
  id: 'pumping-station',
  label: { en: 'Pumping station', ru: 'Насосная станция' },
  equipment: [reservoir, booster, outlet, controller],
  hmi: { width: 320, height: 240, equipment: [reservoir, booster, outlet] },
  pipes: [
    pipe('suction', { from: reservoir.ports.outlet, to: booster.ports.inlet, flow: booster.flow }),
    pipe('discharge', { from: booster.ports.outlet, to: outlet.ports.inlet, flow: booster.flow }),
  ],
  cables: [
    cable('run-command', { from: controller.ports.DO1, to: booster.ports.run, signal: booster.run }),
    cable('valve-command', { from: controller.ports.AO1, to: outlet.ports.command, signal: outlet.opening }),
  ],
  alarms: [alarm('high-pressure', {
    label: { en: 'High discharge pressure', ru: 'Высокое давление на выходе' },
    signal: booster.pressure, above: 4.5, hysteresis: 0.25,
  })],
  reports: [hourlyWater],
});
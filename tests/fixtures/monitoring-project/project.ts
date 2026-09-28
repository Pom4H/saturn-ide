import { project } from '@saturn/core';
import { pumpHealth, reservoirHealth } from './plugins/station-monitor';

export default project({
  id: 'monitoring-fixture', label: { en: 'Monitoring test station', ru: 'Станция мониторинга' },
  equipment: [], pipes: [], alarms: [], monitoring: [pumpHealth, reservoirHealth],
});

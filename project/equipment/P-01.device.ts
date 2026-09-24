import { pump, signal } from '@saturn/core';

const booster = pump('P-01', {
  semanticId: 'equipment:booster-primary',
  label: { en: 'Booster pump', ru: 'Повысительный насос' },
  x: 335, y: 190,
  rpm: signal({ initial: 0, unit: 'rpm', min: 0, max: 3000, description:{en:'Measured shaft speed',ru:'Измеренные обороты вала'} }),
  run: signal({ initial: true, writable: true, description:{en:'Start command',ru:'Команда пуска'} }),
  flow: signal({ initial: 0, unit: 'm³/h', min: 0, dimension:'flow', description:{en:'Discharge flow',ru:'Расход на выходе'} }),
  pressure: signal({ initial: 0, unit: 'bar', min: 0, dimension:'pressure', description:{en:'Discharge pressure',ru:'Давление на выходе'} }),
});
export default booster;
import { signal, tank } from '@saturn/core';
export default tank('TK-01', {
  semanticId:'equipment:supply-tank',
  label: { en: 'Supply tank', ru: 'Питающий резервуар' },
  x: 60, y: 65,
  level: signal({ initial: 64, unit: '%', min: 0, max: 100, description:{en:'Liquid level',ru:'Уровень жидкости'} }),
});
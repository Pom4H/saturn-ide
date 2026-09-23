import { tank } from '@saturn/core';
import { signals } from '../signals';
export default tank('TK-01', {
  label: { en: 'Supply tank', ru: 'Питающий резервуар' },
  x: 60, y: 65, level: signals.level,
});

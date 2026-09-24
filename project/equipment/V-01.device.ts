import { signal, valve } from '@saturn/core';
export default valve('V-01', {
  semanticId:'equipment:outlet-valve',
  label: { en: 'Outlet valve', ru: 'Выходной клапан' },
  x: 660, y: 65,
  opening: signal({ initial: 75, unit: '%', writable: true, min: 0, max: 100, description:{en:'Valve opening',ru:'Открытие клапана'} }),
});
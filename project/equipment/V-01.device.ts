import { valve } from '@saturn/core';
import { signals } from '../signals';
export default valve('V-01', {
  label: { en: 'Outlet valve', ru: 'Выходной клапан' },
  x: 660, y: 65, opening: signals.opening,
});

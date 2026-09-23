import { pump } from '@saturn/core';
import { signals } from '../signals';

const booster = pump('P-01', {
  label: { en: 'Booster pump', ru: 'Повысительный насос' },
  x: 335, y: 190,
  rpm: signals.rpm, run: signals.run,
});
export default booster;

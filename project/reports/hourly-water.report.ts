import { column, report } from '@saturn/core';
import { signals } from '../signals';
export default report('hourly-water', {
  label: { en: 'Hourly water balance', ru: 'Почасовой расход воды' },
  bucketMs: 3600_000,
  columns: {
    volume: column(signals.flow, 'integral', { en: 'Volume', ru: 'Объём' }, 'm³'),
    meanFlow: column(signals.flow, 'mean', { en: 'Mean flow', ru: 'Средний расход' }, 'm³/h'),
    peakPressure: column(signals.pressure, 'max', { en: 'Peak pressure', ru: 'Макс. давление' }, 'bar'),
  },
});

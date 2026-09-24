import { column, report } from '@saturn/core';
import booster from '../equipment/P-01.device';
export default report('hourly-water', {
  label: { en: 'Hourly water balance', ru: 'Почасовой расход воды' },
  bucketMs: 3600_000,
  columns: {
    volume: column(booster.flow, 'integral', { en: 'Volume', ru: 'Объём' }, 'm³'),
    meanFlow: column(booster.flow, 'mean', { en: 'Mean flow', ru: 'Средний расход' }, 'm³/h'),
    peakPressure: column(booster.pressure, 'max', { en: 'Peak pressure', ru: 'Макс. давление' }, 'bar'),
  },
});
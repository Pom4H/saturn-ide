import { monitor, monitorMetric, signal } from '@saturn/core';

// This copied source owns engineering checks. The observations still come from the
// project's explicit simulator or another acquisition driver, never from initial.
export const pressure = signal('P-101.pressure', { initial: 0, unit: 'bar', staleAfter: 3000 });
export const flow = signal('P-101.flow', { initial: 0, unit: 'm³/h', staleAfter: 3000 });
export const level = signal('TK-101.level', { initial: 0, unit: '%', staleAfter: 3000 });

export const pumpHealth = monitor('pump-health', {
  label: { en: 'Pump P-101', ru: 'Насос P-101' },
  description: { en: 'Hydraulic range from the project plugin', ru: 'Гидравлический диапазон из плагина проекта' },
  metrics: [
    monitorMetric('pressure', pressure, { label: { en: 'Outlet pressure', ru: 'Давление на выходе' }, warning: { below: 2, above: 6 }, critical: { below: 1, above: 9 }, maxAgeMs: 2000 }),
    monitorMetric('flow', flow, { label: { en: 'Flow', ru: 'Расход' }, warning: { below: 5 }, critical: { below: 2 } }),
  ],
});

export const reservoirHealth = monitor('reservoir-health', {
  label: { en: 'Tank TK-101', ru: 'Бак TK-101' },
  metrics: [monitorMetric('level', level, { label: { en: 'Level', ru: 'Уровень' }, warning: { below: 30 }, critical: { below: 15 } })],
});

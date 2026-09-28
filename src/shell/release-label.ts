import type { Locale } from '../core';

/** UI wording only. Release identities and their ownership stay unchanged. */
const stages = {
  checked: { ru: 'Проверено', en: 'Checked' },
  published: { ru: 'Опубликовано', en: 'Published' },
  applied: { ru: 'Применено', en: 'Applied' },
} as const;

export function releaseLabel(stage: keyof typeof stages, locale: Locale): string {
  const name=stages[stage];
  return locale==='ru'?`${name.ru} (${name.en})`:name.en;
}

const phases: Record<string, Record<Locale,string>> = {
  empty: { ru: 'Нет применённой сборки', en: 'No applied build' },
  running: { ru: 'Исполняется', en: 'Running' },
  applying: { ru: 'Применение сборки', en: 'Applying build' },
  faulted: { ru: 'Ошибка', en: 'Faulted' },
  closed: { ru: 'Остановлено', en: 'Stopped' },
};

export function releasePhaseLabel(phase: string | undefined, locale: Locale): string {
  return phase ? phases[phase]?.[locale] ?? phase : '—';
}

export function releaseComparisonLabel(releases:{checked:string|null;published:string|null;applied:string|null},locale:Locale):string {
  const ru=locale==='ru';
  if(!releases.checked)return ru?'Нет проверенной сборки.':'No checked build.';
  if(!releases.applied)return ru?'Проверенная сборка ещё не применена.':'The checked build has not been applied.';
  if(releases.checked!==releases.applied)return ru?'Проверенная и применённая сборки различаются.':'Checked and applied builds differ.';
  return releases.published===releases.checked
    ?ru?'Проверенная, опубликованная и применённая сборки совпадают.':'Checked, published and applied builds match.'
    :ru?'Проверенная сборка применена; опубликованная версия отличается или отсутствует.':'The checked build is applied; the published version differs or is absent.';
}

import { useMemo, useState } from 'react';
import { text, type Locale, type Text } from '../core';

export type ProjectStage = 'production' | 'engineering';
export interface ProjectSummary {
  id: string;
  label: Text;
  stage: ProjectStage;
  connected: boolean;
  events: number;
  lastActivity: number;
}

export function ProjectSidebar({ projects, current, locale, open }: {
  projects: readonly ProjectSummary[];
  current: string;
  locale: Locale;
  open: (id: string) => void;
}) {
  const ru = locale === 'ru';
  const [filter, setFilter] = useState<'all' | ProjectStage>('all');
  const [sort, setSort] = useState<'recent' | 'events' | 'alpha'>('recent');
  const visible = useMemo(() => projects
    .filter(project => filter === 'all' || project.stage === filter)
    .toSorted((a, b) => sort === 'alpha'
      ? text(a.label, locale).localeCompare(text(b.label, locale))
      : sort === 'events'
        ? b.events - a.events
        : b.lastActivity - a.lastActivity), [projects, filter, sort, locale]);

  return <aside className="project-sidebar">
    <div className="project-sidebar-head"><strong>{ru ? 'Проекты' : 'Projects'}</strong><button aria-label={ru ? 'Добавить проект' : 'Add project'}>+</button></div>
    <div className="project-filters">
      <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{ru ? 'Все' : 'All'}</button>
      <button aria-pressed={filter === 'production'} onClick={() => setFilter('production')}>{ru ? 'Прод' : 'Prod'}</button>
      <button aria-pressed={filter === 'engineering'} onClick={() => setFilter('engineering')}>{ru ? 'Проектирование' : 'Engineering'}</button>
    </div>
    <label className="project-sort"><span>{ru ? 'Сортировка' : 'Sort'}</span><select value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
      <option value="recent">{ru ? 'Последние' : 'Recent'}</option>
      <option value="events">{ru ? 'По событиям' : 'Events'}</option>
      <option value="alpha">A–Z</option>
    </select></label>
    <nav className="project-list" aria-label={ru ? 'Список проектов' : 'Project list'}>
      {visible.map(project => <button key={project.id} className={current === project.id ? 'active' : ''} onClick={() => open(project.id)}>
        <span className={`project-dot ${project.stage} ${project.connected ? '' : 'offline'}`}/>
        <span className="project-copy"><strong>{text(project.label, locale)}</strong><small>{project.stage === 'production' ? (ru ? 'В проде' : 'Production') : (ru ? 'Проектирование' : 'Engineering')}</small></span>
        {!!project.events && <b className="project-events">{project.events}</b>}
      </button>)}
      {!visible.length && <p className="muted project-empty">{ru ? 'Нет проектов' : 'No projects'}</p>}
    </nav>
  </aside>;
}

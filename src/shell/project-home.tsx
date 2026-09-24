import { text, type Equipment, type Locale, type Project, type Snapshot } from '../core';
import { ResourceIcon } from './icons';

export function ProjectHome({ project, snapshot, locale, connected, mode, revision, branch, dirty, openSurface, openEquipment }: {
  project: Project;
  snapshot: Snapshot;
  locale: Locale;
  connected: boolean;
  mode: string;
  revision: string;
  branch: string;
  dirty: number;
  openSurface: (surface: 'diagram' | 'source' | 'signals' | 'reports' | 'targets' | 'git') => void;
  openEquipment: (equipment: Equipment) => void;
}) {
  const ru = locale === 'ru';
  const alarms = Object.values(snapshot.alarms).filter(alarm => alarm.active);
  const unhealthy = project.equipment.filter(equipment => {
    const ids = equipment.kind === 'pump' ? [equipment.rpm.id, equipment.run?.id] : equipment.kind === 'tank' ? [equipment.level.id] : equipment.kind === 'valve' ? [equipment.opening.id] : [equipment.online.id];
    return ids.filter(Boolean).some(id => snapshot.samples[id!]?.quality !== 'good');
  });
  return <section className="project-home">
    <header className="project-home-header">
      <div><span className="eyebrow">{ru ? 'Инженерный проект' : 'Engineering project'}</span><h1>{text(project.label, locale)}</h1><p>{project.id}</p></div>
      <div className="project-health"><span className={connected ? 'good' : 'bad'}>{connected ? (ru ? 'Связь есть' : 'Connected') : (ru ? 'Нет связи' : 'Disconnected')}</span><strong>{mode}</strong></div>
    </header>
    <div className="project-actions">
      <button className="primary" onClick={() => openSurface('diagram')}><ResourceIcon icon="diagram"/>{ru ? 'Открыть схему' : 'Open diagram'}</button>
      <button onClick={() => openSurface('signals')}><ResourceIcon icon="signals"/>{ru ? 'Сигналы' : 'Signals'}</button>
      <button onClick={() => openSurface('reports')}><ResourceIcon icon="reports"/>{ru ? 'Отчёты' : 'Reports'}</button>
      <button onClick={() => openSurface('source')}><ResourceIcon icon="source"/>{ru ? 'Исходник' : 'Source'}</button>
    </div>
    <div className="project-overview-grid">
      <article className="overview-card attention">
        <header><strong>{ru ? 'Требует внимания' : 'Needs attention'}</strong><span>{alarms.length + unhealthy.length}</span></header>
        {alarms.slice(0,4).map(alarm => <button key={alarm.id} onClick={() => openSurface('signals')}><span className="bad">●</span><code>{alarm.id}</code><small>{ru ? 'активная тревога' : 'active alarm'}</small></button>)}
        {unhealthy.slice(0,4).map(equipment => <button key={equipment.id} onClick={() => openEquipment(equipment)}><span className="stale">●</span><strong>{equipment.id}</strong><small>{ru ? 'недостоверные данные' : 'stale/bad data'}</small></button>)}
        {!alarms.length && !unhealthy.length && <p className="muted">{ru ? 'Нет активных проблем.' : 'No active problems.'}</p>}
      </article>
      <article className="overview-card revisions">
        <header><strong>{ru ? 'Версия на объекте' : 'Revision on site'}</strong><button onClick={() => openSurface('targets')}>{ru ? 'Подробнее' : 'Details'} ↗</button></header>
        <div className="revision-line"><span>Source</span><code>{branch || '—'}{dirty ? ` +${dirty}` : ''}</code></div>
        <div className="revision-line"><span>Applied</span><code>{revision.slice(0,12)}</code></div>
      </article>
      <article className="overview-card equipment-card">
        <header><strong>{ru ? 'Оборудование' : 'Equipment'}</strong><span>{project.equipment.length}</span></header>
        <div className="equipment-quick-list">{project.equipment.slice(0,8).map(equipment => <button key={equipment.id} onClick={() => openEquipment(equipment)}><ResourceIcon icon={equipment.kind}/><span><strong>{equipment.id}</strong><small>{text(equipment.label, locale)}</small></span></button>)}</div>
      </article>
      <article className="overview-card activity-card">
        <header><strong>{ru ? 'Рабочий поток' : 'Workstream'}</strong><button onClick={() => openSurface('git')}>Git ↗</button></header>
        <button onClick={() => openSurface('diagram')}><span className="activity-mark"/> <span><strong>{ru ? 'Схема и модель' : 'Diagram & model'}</strong><small>{ru ? 'Редактирование физического объекта' : 'Edit the physical system'}</small></span></button>
        <button onClick={() => openSurface('signals')}><span className="activity-mark"/> <span><strong>{ru ? 'Runtime' : 'Runtime'}</strong><small>{ru ? 'Сигналы, история и состояние' : 'Signals, history and state'}</small></span></button>
        <button onClick={() => openSurface('targets')}><span className="activity-mark"/> <span><strong>{ru ? 'Применение' : 'Deployment'}</strong><small>{ru ? 'Checked → Published → Applied' : 'Checked → Published → Applied'}</small></span></button>
      </article>
    </div>
  </section>;
}

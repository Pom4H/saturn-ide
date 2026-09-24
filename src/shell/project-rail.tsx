import { text, type Locale, type Text } from '../core';

export interface ProjectRailItem {
  id: string;
  label: Text;
  stage: 'production' | 'engineering';
  connected: boolean;
  events: number;
  recentAt: number;
}

export function ProjectRail({ projects, current, locale, open }: {
  projects: readonly ProjectRailItem[];
  current: string;
  locale: Locale;
  open: (id: string) => void;
}) {
  const ru = locale === 'ru';
  const [currentProject] = projects.filter(project => project.id === current);
  return <aside className="project-rail" aria-label={ru ? 'Проекты' : 'Projects'}>
    <div className="project-rail-head"><strong>{ru ? 'Проекты' : 'Projects'}</strong><button aria-label={ru ? 'Добавить проект' : 'Add project'}>+</button></div>
    <div className="project-rail-sort"><button className="active">{ru ? 'Последние' : 'Recent'}</button><button>{ru ? 'События' : 'Events'}</button><button>A–Z</button></div>
    <div className="project-rail-section"><span>{currentProject?.stage === 'production' ? (ru ? 'В ПРОДЕ' : 'PRODUCTION') : (ru ? 'ПРОЕКТИРОВАНИЕ' : 'ENGINEERING')}</span>
      {projects.map(project => <button key={project.id} className={project.id === current ? 'active' : ''} onClick={() => open(project.id)}>
        <span className={`project-state-dot ${project.stage} ${project.connected ? '' : 'offline'}`}/>
        <span className="project-rail-copy"><strong>{text(project.label, locale)}</strong><small>{project.stage === 'production' ? (ru ? 'Работает' : 'Live') : (ru ? 'Разработка' : 'Design')}</small></span>
        {!!project.events && <b>{project.events}</b>}
      </button>)}
    </div>
    <div className="project-rail-footer"><button>{ru ? 'Открыть проект…' : 'Open project…'}</button></div>
  </aside>;
}

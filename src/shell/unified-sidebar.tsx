import { text, type Locale } from '../core';
import { editorNames, type EditorId, type ProjectResource } from '../core/resources';
import { ResourceIcon } from './icons';

export function UnifiedSidebar({ locale, project, mode, surface, surfaces, context, active, selectSurface, open }: {
  locale: Locale;
  project: { label: Parameters<typeof text>[0] };
  mode: 'simulation' | 'live' | 'offline';
  surface: EditorId;
  surfaces: readonly EditorId[];
  context: readonly ProjectResource[];
  active?: string;
  selectSurface: (surface: EditorId) => void;
  open: (resource: ProjectResource) => void;
}) {
  const ru=locale==='ru';
  return <aside className="unified-sidebar">
    <button className="projects-back"><ResourceIcon icon="back" size={16}/><span>{ru?'Проекты':'Projects'}</span></button>
    <div className="sidebar-project">
      <strong>{text(project.label,locale)}</strong>
      <span className={mode==='live'?'good':'stale'}>● {mode==='live'?(ru?'Production':'Production'):(ru?'Проектирование':'Engineering')}</span>
    </div>
    <nav className="sidebar-surfaces" aria-label={ru?'Рабочие разделы':'Workspaces'}>
      {surfaces.map(id=><button key={id} className={surface===id?'active':''} aria-current={surface===id?'page':undefined} onClick={()=>selectSurface(id)}>
        <ResourceIcon icon={id} size={18}/><span>{editorNames[id][locale]}</span>
      </button>)}
    </nav>
    <div className="sidebar-context">
      <span className="sidebar-context-title">{surface==='diagram'?(ru?'ОБОРУДОВАНИЕ':'EQUIPMENT'):editorNames[surface][locale].toUpperCase()}</span>
      {context.slice(0,12).map(resource=><button key={resource.uri} className={active===resource.uri?'active':''} onClick={()=>open(resource)} title={resource.source?.path}>
        <ResourceIcon icon={resource.icon} size={17}/><span>{resource.entityId || resource.name[locale]}</span>
      </button>)}
    </div>
  </aside>;
}

import { useState, type ReactNode } from 'react';
import { findResources, type ResourceCatalog, type ProjectResource, type ShellLocale } from '../core/resources';
import { ResourceIcon } from './icons';
export function ResourceExplorer({ catalog, locale, active, open }: { catalog: ResourceCatalog; locale: ShellLocale; active?: string; open: (resource: ProjectResource) => void }) {
  const [query, setQuery] = useState(''), [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (uri: string) => setExpanded(before => { const next = new Set(before); if (next.has(uri)) next.delete(uri); else next.add(uri); return next; });
  const matches = new Set(findResources(catalog, query, locale).map(r => r.uri));
  const visible = (resource: ProjectResource, seen = new Set<string>()): boolean => {
    if (seen.has(resource.uri)) return false; seen.add(resource.uri);
    return matches.has(resource.uri) || catalog.resources.some(child => child.parent === resource.uri && visible(child, seen));
  };
  const branch = (resource: ProjectResource, depth = 0): ReactNode => {
    if (!visible(resource) || depth > 8) return null;
    const children = catalog.resources.filter(r => r.parent === resource.uri && r.uri !== resource.uri);
    const isOpen = !!query || expanded.has(resource.uri);
    return <div key={resource.uri} className="resource-node">
      <div className={`resource-row ${active === resource.uri ? 'active' : ''}`} style={{ paddingInlineStart: 8 + depth * 12 }}>
        {children.length ? <button className="resource-disclosure" aria-expanded={isOpen} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${resource.name[locale]}`} onClick={() => toggle(resource.uri)}>{isOpen ? '▾' : '▸'}</button> : <span className="resource-disclosure"/>}
        <button className="resource-open" data-resource={resource.uri} title={`${resource.entityId ?? ''}\n${resource.source?.path ?? ''}`} onClick={() => open(resource)}>
          <ResourceIcon icon={resource.icon}/><span>{resource.name[locale]}</span><code>{resource.entityId}</code>
        </button>
      </div>
      {isOpen && children.map(child => branch(child, depth + 1))}
    </div>;
  };
  return <div className="resource-explorer"><label className="resource-search"><ResourceIcon icon="search" size={16}/><input aria-label={locale === 'ru' ? 'Найти объект или файл' : 'Find object or file'} value={query} onChange={e => setQuery(e.target.value)} placeholder={locale === 'ru' ? 'Имя, класс, файл…' : 'Name, class, file…'}/></label>
    <nav aria-label={locale === 'ru' ? 'Объекты проекта' : 'Project objects'}>{catalog.resources.filter(r => r.parent === catalog.project).map(resource => branch(resource))}</nav>
  </div>;
}

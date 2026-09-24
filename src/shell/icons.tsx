import type { ReactNode } from 'react';

type IconDef = (p: { s: number }) => ReactNode;
const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const icons: Readonly<Record<string, IconDef>> = {
  diagram: () => <><path {...common} d="M4 6h5v5H4zM15 13h5v5h-5z"/><path {...common} d="M9 8.5h3a3 3 0 0 1 3 3V13M6.5 11v6h8.5"/></>,
  source: () => <><path {...common} d="m8 5-4 7 4 7M16 5l4 7-4 7"/><path {...common} d="m14 4-4 16"/></>,
  signals: () => <><path {...common} d="M3 12h3l2.2-5 3.1 10 2.4-7 2 4H21"/></>,
  reports: () => <><path {...common} d="M6 3h8l4 4v14H6z"/><path {...common} d="M14 3v5h5M9 16v-3M12 16v-5M15 16v-2"/></>,
  hmi: () => <><rect {...common} x="3" y="4" width="18" height="13" rx="2"/><path {...common} d="M8 21h8M12 17v4"/><path {...common} d="M7 12h2l2-4 2 6 2-3h2"/></>,
  targets: () => <><path {...common} d="M4 5h16v14H4z"/><path {...common} d="m8 9 3 3-3 3M13 15h3"/></>,
  target: () => <><path {...common} d="M4 5h16v14H4z"/><path {...common} d="m8 9 3 3-3 3M13 15h3"/></>,
  git: () => <><circle {...common} cx="6" cy="5" r="2"/><circle {...common} cx="18" cy="7" r="2"/><circle {...common} cx="6" cy="19" r="2"/><path {...common} d="M6 7v10M8 6h3a4 4 0 0 1 4 4v3M15 13l3-3"/></>,
  pump: () => <><circle {...common} cx="9" cy="12" r="5"/><circle {...common} cx="9" cy="12" r="2"/><path {...common} d="M14 10h4l3 2-3 2h-4M9 7V4h5M4 17h12"/></>,
  tank: () => <><ellipse {...common} cx="12" cy="5" rx="6" ry="2"/><path {...common} d="M6 5v14c0 1.1 2.7 2 6 2s6-.9 6-2V5"/><ellipse {...common} cx="12" cy="19" rx="6" ry="2"/><path {...common} d="M7 14h10"/></>,
  valve: () => <><path {...common} d="M4 9l6 3-6 3zM20 9l-6 3 6 3z"/><path {...common} d="M10 12h4M12 12V7M9 7h6M12 7V4"/></>,
  plc: () => <><rect {...common} x="5" y="5" width="14" height="14" rx="2"/><path {...common} d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></>,
  plugin: () => <><path {...common} d="M8 3v4M16 3v4M6 7h12v5a6 6 0 0 1-12 0zM12 18v3"/></>,
  file: () => <><path {...common} d="M6 3h8l4 4v14H6zM14 3v5h5"/><path {...common} d="m10 12-2 2 2 2M14 12l2 2-2 2"/></>,
  project: () => <><path {...common} d="M3 6h7l2 2h9v11H3z"/></>,
  report: () => <><path {...common} d="M6 3h8l4 4v14H6zM14 3v5h5"/><path {...common} d="M9 16v-3M12 16v-5M15 16v-2"/></>,
  search: () => <><circle {...common} cx="11" cy="11" r="6"/><path {...common} d="m16 16 5 5"/></>,
  '3d': () => <><path {...common} d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/></>,
};

const fallback: IconDef = icons.file!;
export function ResourceIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  const draw = icons[icon] ?? fallback;
  return <svg className="resource-icon codex-icon" data-icon={icon} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{draw({ s: size })}</svg>;
}

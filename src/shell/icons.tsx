import type { ReactNode } from 'react';

type IconDef=()=>ReactNode;
const p={fill:'none',stroke:'currentColor',strokeWidth:1.75,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};

const icons:Readonly<Record<string,IconDef>>={
  performance:()=> <><path {...p} d="M3 3v18h18M6 16l4-7 4 4 6-9"/></>,
  server:()=> <><rect {...p} x="4" y="3" width="16" height="7" rx="1"/><rect {...p} x="4" y="14" width="16" height="7" rx="1"/><path {...p} d="M7 6.5h.1M11 6.5h6M7 17.5h.1M11 17.5h6"/></>,
  pause:()=> <><path {...p} d="M8 5v14M16 5v14"/></>,
  play:()=> <path {...p} d="m8 4 12 8-12 8z"/>,
  assistant:()=> <><path {...p} d="M4 4h16v12H9l-5 4zM8 8h8M8 12h5"/></>,
  diagram:()=> <><rect {...p} x="3" y="3" width="7" height="7" rx="1"/><rect {...p} x="14" y="14" width="7" height="7" rx="1"/><path {...p} d="M7 10v4a3 3 0 0 0 3 3h4M17 14v-4a3 3 0 0 0-3-3h-4"/></>,
  source:()=> <><path {...p} d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></>,
  signals:()=> <path {...p} d="M3 12h3l2.2-6 3.4 12 3-9 2.2 5H21"/>,
  reports:()=> <><path {...p} d="M6 2h8l4 4v16H6zM14 2v5h5"/><path {...p} d="M9 17v-3M12 17v-6M15 17v-4"/></>,
  report:()=> <><path {...p} d="M6 2h8l4 4v16H6zM14 2v5h5"/><path {...p} d="M9 17v-3M12 17v-6M15 17v-4"/></>,
  hmi:()=> <><rect {...p} x="3" y="4" width="18" height="13" rx="2"/><path {...p} d="M8 21h8M12 17v4"/></>,
  docs:()=> <><path {...p} d="M5 3h10l4 4v14H5zM15 3v5h5"/><path {...p} d="M8 12h8M8 16h8"/></>,
  targets:()=> <><rect {...p} x="3" y="4" width="18" height="16" rx="2"/><path {...p} d="m7 9 3 3-3 3M13 15h4"/></>,
  target:()=> <><rect {...p} x="3" y="4" width="18" height="16" rx="2"/><path {...p} d="m7 9 3 3-3 3M13 15h4"/></>,
  git:()=> <><circle {...p} cx="6" cy="4" r="2"/><circle {...p} cx="18" cy="6" r="2"/><circle {...p} cx="6" cy="20" r="2"/><path {...p} d="M6 6v12M8 5h4a4 4 0 0 1 4 4v5M13 11l3 3 3-3"/></>,
  pump:()=> <><circle {...p} cx="10" cy="12" r="5"/><circle {...p} cx="10" cy="12" r="1.5"/><path {...p} d="M15 10h5v4h-5M10 7V4h4M5 17h12"/></>,
  tank:()=> <><ellipse {...p} cx="12" cy="5" rx="6" ry="2.5"/><path {...p} d="M6 5v14c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5"/><path {...p} d="M6 14c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/></>,
  valve:()=> <><path {...p} d="m4 9 6 3-6 3zM20 9l-6 3 6 3zM10 12h4M12 12V6M9 6h6"/></>,
  plc:()=> <><rect {...p} x="5" y="5" width="14" height="14" rx="2"/><rect {...p} x="9" y="9" width="6" height="6" rx="1"/><path {...p} d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></>,
  dependencies:()=> <><path {...p} d="M8 3v4M16 3v4M6 7h12v5a6 6 0 0 1-12 0zM12 18v3"/></>,
  plugin:()=> <><path {...p} d="M8 3v4M16 3v4M6 7h12v5a6 6 0 0 1-12 0zM12 18v3"/></>,
  file:()=> <><path {...p} d="M6 2h8l4 4v16H6zM14 2v5h5"/><path {...p} d="m10 12-2 2 2 2M14 12l2 2-2 2"/></>,
  project:()=> <path {...p} d="M3 6h7l2 2h9v11H3z"/>,
  search:()=> <><circle {...p} cx="11" cy="11" r="6"/><path {...p} d="m16 16 5 5"/></>,
  more:()=> <><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></>,
  menu:()=> <path {...p} d="M4 6h16M4 12h16M4 18h16"/>,
  sidebar:()=> <><rect {...p} x="2.5" y="3" width="19" height="18" rx="3"/><path {...p} d="M9.5 3v18"/></>,
  bell:()=> <><path {...p} d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path {...p} d="M10 21h4"/></>,
  sun:()=> <><circle {...p} cx="12" cy="12" r="4"/><path {...p} d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></>,
  moon:()=> <path {...p} d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8z"/>,
  back:()=> <><path {...p} d="m15 18-6-6 6-6"/><path {...p} d="M9 12h11"/></>,
  chevron:()=> <path {...p} d="m9 10 3 3 3-3"/>,
  'collapse-tree':()=> <><path {...p} d="M8 3h12v12M4 8h11v12H4zM7 14h5"/></>,
  'chevron-right':()=> <path {...p} d="m9 6 6 6-6 6"/>,
  fit:()=> <><path {...p} d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><rect {...p} x="8" y="8" width="8" height="8" rx="1"/></>,
  ports:()=> <><path {...p} d="M8 3v5M16 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4"/></>,
  inspector:()=> <><rect {...p} x="3" y="3" width="18" height="18" rx="2"/><path {...p} d="M15 3v18M18 7h.1M18 11h.1M18 15h.1"/></>,
  terminal:()=> <><rect {...p} x="3" y="4" width="18" height="16" rx="2"/><path {...p} d="m7 9 3 3-3 3M13 15h4"/></>,
  panel:()=> <><rect {...p} x="3" y="3" width="18" height="18" rx="2"/><path {...p} d="M3 15h18"/></>,
  expand:()=> <path {...p} d="M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6"/>,
  restore:()=> <><rect {...p} x="3" y="8" width="13" height="13" rx="2"/><path {...p} d="M8 8V3h13v13h-5"/></>,
  'chevron-up':()=> <path {...p} d="m6 15 6-6 6 6"/>,
  'chevron-down':()=> <path {...p} d="m6 9 6 6 6-6"/>,
  close:()=> <path {...p} d="m6 6 12 12M18 6 6 18"/>,
  warning:()=> <><path {...p} d="m12 3 10 18H2zM12 9v5M12 17v.1"/></>,
  '3d':()=> <><path {...p} d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/></>,
};
const fallback=icons.file!;
export function ResourceIcon({icon,size=18}:{icon:string;size?:number}){
  const draw=icons[icon]??fallback;
  return <svg className="resource-icon codex-icon" data-icon={icon} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{draw()}</svg>;
}

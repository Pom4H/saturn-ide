import { mdiPump, mdiStorageTank, mdiValve, mdiChip, mdiPuzzleOutline, mdiFileCodeOutline,
  mdiFileChartOutline, mdiMonitorDashboard, mdiFolderOutline, mdiConsoleLine, mdiSourceBranch,
  mdiVectorPolyline, mdiCodeBraces, mdiChartTimelineVariant, mdiCubeOutline, mdiMagnify } from '@mdi/js';
const paths: Readonly<Record<string, string>> = {
  pump: mdiPump, tank: mdiStorageTank, valve: mdiValve, plc: mdiChip, plugin: mdiPuzzleOutline,
  file: mdiFileCodeOutline, report: mdiFileChartOutline, reports: mdiFileChartOutline, hmi: mdiMonitorDashboard,
  project: mdiFolderOutline, target: mdiConsoleLine, targets: mdiConsoleLine, git: mdiSourceBranch,
  diagram: mdiVectorPolyline, source: mdiCodeBraces, signals: mdiChartTimelineVariant, '3d': mdiCubeOutline, search: mdiMagnify,
};
/** One icon mapping for explorer, tabs, picker and resource header. Pictogrammers MDI, Apache-2.0. */
export function ResourceIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  return <svg className="resource-icon" data-icon={icon} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d={paths[icon] ?? mdiChip}/></svg>;
}

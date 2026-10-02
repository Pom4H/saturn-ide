import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../shell/app';
import type { ComponentProps } from 'react';
import type { ScadaImporter } from '../core/importer';
import '../shell/styles.css';

type Displays = NonNullable<ComponentProps<typeof App>['displays']>;
export interface BrowserExtensions {readonly displays?:Displays;readonly importers?:readonly ScadaImporter[]}
export type BrowserProject = Displays | BrowserExtensions;
/** A project explicitly supplies browser extensions. Vendor source is imported by project browser.ts, never by the IDE. */
export function mount(project: BrowserProject = {}, embedded=false) {
  const extensions:BrowserExtensions=('displays' in project||Array.isArray((project as BrowserExtensions).importers))?project as BrowserExtensions:{displays:project as Displays};
  const root=createRoot(document.getElementById('root')!);
  root.render(<StrictMode><App displays={extensions.displays} importers={extensions.importers} embedded={embedded}/></StrictMode>);
  return ()=>root.unmount();
}

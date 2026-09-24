import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../shell/app';
import type { ComponentProps } from 'react';
import '../shell/styles.css';

/** A project explicitly supplies its browser renderers. No vendor imports in the IDE. */
export function mount(displays: ComponentProps<typeof App>['displays'] = {}) {
  createRoot(document.getElementById('root')!).render(<StrictMode><App displays={displays}/></StrictMode>);
}

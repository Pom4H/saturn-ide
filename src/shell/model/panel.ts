/** Shell layout only. Observations and alarm acknowledgement remain owned by runtime. */
export type PanelTab = 'equipment' | 'graphs' | 'terminal' | 'notifications';
export interface PanelState { tab: PanelTab; open: boolean; height: number; maximized: boolean }
export type PanelAction =
  | { type: 'open'; tab: PanelTab }
  | { type: 'toggle' }
  | { type: 'close' }
  | { type: 'maximize' }
  | { type: 'resize'; height: number };
export const initialPanel: PanelState = { tab: 'equipment', open: false, height: 200, maximized: false };
/** Keep the environment and scenario layouts separate without unmounting the shared terminal. */
export type PanelLayouts = { work:PanelState; environment:PanelState; scenarios:PanelState };
export function panelLayoutsReducer(state:PanelLayouts, action:{context:keyof PanelLayouts;action:PanelAction}):PanelLayouts {
  return {...state,[action.context]:panelReducer(state[action.context],action.action)};
}
export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'open': return { ...state, tab: action.tab, open: true, height:action.tab==='terminal'?Math.max(320,state.height):state.height };
    case 'toggle': return { ...state, open: !state.open };
    case 'close': return { ...state, open: false };
    case 'maximize': return { ...state, open: true, maximized: !state.maximized };
    case 'resize': return { ...state, open: true, maximized: false, height: Math.max(140, Math.min(720, action.height)) };
  }
}

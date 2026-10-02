import type { BrowserView } from './browser-view';

export type ShellPage = 'home' | 'resources' | 'threads' | 'settings';
export type DetailsSlot = 'none' | 'properties' | 'review' | 'catalog' | 'source';
/** The tool remains owned by ShellSession when its slot closes or displays the launcher. */
export interface ShellLayout {
  page:ShellPage;
  artifact: {visibility:'central'|'closed'|'split'|'full';content:'tool'|'launcher'};
  details:DetailsSlot;
  summary:boolean;
}
export type LayoutAction =
  | {type:'navigate';page:'home'|'threads'|'settings'}
  | {type:'open-tool';page?:'resources'}
  | {type:'new-tab';page?:'resources'}
  | {type:'close-new-tab'}
  | {type:'show-pane'}
  | {type:'close-pane'}
  | {type:'toggle-full'}
  | {type:'details';slot:DetailsSlot}
  | {type:'toggle-details';slot:Exclude<DetailsSlot,'none'>}
  | {type:'summary';open:boolean}
  | {type:'toggle-summary'}
  | {type:'restore';view:BrowserView};

export function layoutFromView(view:BrowserView):ShellLayout {
  const page=view.page==='chat'?'threads':view.page==='home'||view.page==='settings'?view.page:'resources';
  return {page,artifact:{visibility:page==='resources'?'central':page==='threads'&&view.pane?(view.full?'full':'split'):'closed',content:view.newTab?'launcher':'tool'},details:page==='settings'?'none':view.details,summary:false};
}
export function layoutReducer(state:ShellLayout, action:LayoutAction):ShellLayout {
  switch(action.type){
    case 'restore':return layoutFromView(action.view);
    case 'navigate':return {page:action.page,artifact:{visibility:'closed',content:'tool'},details:'none',summary:false};
    case 'open-tool': {const page=action.page??(state.page==='threads'?'threads':'resources');return {...state,page,artifact:{visibility:page==='resources'?'central':state.artifact.visibility==='full'?'full':'split',content:'tool'},summary:false};}
    case 'new-tab': {const page=action.page??(state.page==='threads'?'threads':'resources');return {...state,page,artifact:{visibility:page==='resources'?'central':state.artifact.visibility==='full'?'full':'split',content:'launcher'},details:'none',summary:false};}
    case 'close-new-tab':return {...state,artifact:{...state.artifact,content:'tool'}};
    case 'show-pane':return state.page==='threads'?{...state,artifact:{...state.artifact,visibility:'split'}}:state;
    case 'close-pane':return state.page==='threads'?{...state,artifact:{...state.artifact,visibility:'closed'}}:state;
    case 'toggle-full':return state.page==='threads'?{...state,artifact:{...state.artifact,visibility:state.artifact.visibility==='full'?'split':'full'}}:state;
    case 'details':return {...state,details:state.page==='settings'?'none':action.slot};
    case 'toggle-details':return {...state,details:state.page==='settings'||state.details===action.slot?'none':action.slot};
    case 'summary':return {...state,summary:action.open};
    case 'toggle-summary':return {...state,summary:!state.summary};
  }
}
/** URL adapter preserves the existing public query contract without boolean layout state. */
export function layoutViewFields(layout:ShellLayout):Pick<BrowserView,'details'|'newTab'|'pane'|'full'> {
  return {details:layout.details,newTab:layout.artifact.content==='launcher',pane:layout.artifact.visibility==='split'||layout.artifact.visibility==='full',full:layout.artifact.visibility==='full'};
}
export const detailsVisible=(layout:ShellLayout):boolean=>layout.page!=='settings'&&layout.details!=='none'&&(layout.page!=='threads'||layout.artifact.visibility!=='closed'&&layout.artifact.content==='tool');

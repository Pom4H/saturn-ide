import { editorNames, type EditorId } from '../../core/resources';
import type { PanelTab } from './panel';
/** A link to a projection of the existing ShellSession; never authored or runtime state. */
export interface BrowserView {
  page:'home'|'settings'|'chat'|'task'|EditorId; tool:EditorId; uri:string; file:string; device:string; signal:string; report:string;
  port?:string;
  settings?:'general'|'appearance'|'notifications'|'shortcuts'|'about';
  viewBox?:[number,number,number,number]; camera?:[number,number,number,number,number,number];
  dimension:'2d'|'mounting'|'3d'; panel:PanelTab; panelOpen:boolean; details:'none'|'properties'|'review'|'catalog'|'source';
  hmi:'overview'|'detail'; system:string; operator:boolean; newTab:boolean; pane:boolean; full:boolean;
}
const editor=(value:string|null):EditorId|undefined=>value&&Object.hasOwn(editorNames,value)?value as EditorId:undefined;
const panels:readonly PanelTab[]=['equipment','graphs','terminal','notifications'];
function coordinates(value:string|null,count:number):number[]|undefined {
  if(!value)return;const values=value.split(',').map(Number);return values.length===count&&values.every(item=>Number.isFinite(item)&&Math.abs(item)<1e7)?values:undefined;
}
export function readBrowserView(search:string):BrowserView {
  const params=new URLSearchParams(search),page=params.get('page');
  const box=coordinates(params.get('viewBox'),4),pose=coordinates(params.get('camera'),6);
  const settings=['general','appearance','notifications','shortcuts','about'].find(value=>value===params.get('settings')) as BrowserView['settings'];
  return {settings:page==='settings'?settings??'general':undefined,viewBox:box&&box[2]!>0&&box[3]!>0?box as BrowserView['viewBox']:undefined,camera:pose as BrowserView['camera'],page:page==='chat'||page==='home'||page==='settings'||page==='task'?page:editor(page)??'home',tool:editor(params.get('tool'))??editor(page)??'diagram',
    port:params.get('port')??undefined,uri:params.get('uri')??'',file:params.get('file')??'',device:params.get('device')??'',signal:params.get('signal')??'',report:params.get('report')??'',
    dimension:params.get('dimension')==='mounting'?'mounting':params.get('dimension')==='3d'||!params.has('dimension')&&(!page||page==='home')?'3d':'2d',panel:panels.find(tab=>tab===params.get('panel'))??'equipment',panelOpen:params.get('panelOpen')==='1',
    details:params.get('details')==='source'?'source':params.get('details')==='catalog'?'catalog':params.get('details')==='review'?'review':params.get('details')==='properties'?'properties':'none',hmi:params.get('hmi')==='detail'?'detail':'overview',
    system:params.get('system')??'',operator:params.get('mode')==='operator',newTab:params.get('newTab')==='1',pane:params.get('pane')==='1',full:params.get('full')==='1'};
}
export function browserViewSearch(view:BrowserView):string {
  const params=new URLSearchParams();params.set('page',view.page);
  const values:Record<string,string>={settings:view.page==='settings'?view.settings??'general':'',viewBox:view.viewBox?.map(value=>Number(value.toFixed(4))).join(',')??'',camera:view.camera?.map(value=>Number(value.toFixed(4))).join(',')??'',tool:view.page==='chat'||view.page==='settings'||view.page==='task'?view.tool:'',uri:view.uri,file:view.file,device:view.device,port:view.port??'',signal:view.signal,report:view.report,
    dimension:view.dimension==='mounting'?'mounting':view.dimension==='3d'?'3d':view.page==='home'?'2d':'',panel:view.panel,panelOpen:view.panelOpen?'1':'0',details:view.details!=='none'||view.page==='task'?view.details:'',hmi:view.tool==='hmi'?view.hmi:'',
    system:view.system,mode:view.operator?'operator':'',newTab:view.newTab?'1':'',pane:view.page==='chat'&&view.pane?'1':'',full:view.page==='chat'&&view.full?'1':''};
  for(const [key,value] of Object.entries(values))if(value)params.set(key,value);
  return '?'+params.toString();
}

import type { Endpoint, Point, Project } from '../core';
import { authoringChanges } from './authoring-operations';
import type { AuthoringOperation } from '../core/authoring';
import { HttpError, type Workspace } from './files';
export interface CableEndpointEdit { path:string; version:string; source:string; from:string; to:string }
/** Compatibility transport adapter; all inverse edits are owned by the shared source operation planner. */
function preview(workspace:Workspace, project:Project, operation:AuthoringOperation):CableEndpointEdit {
  const files=workspace.list().filter(path=>/\.tsx?$/.test(path)).map(path=>workspace.read(path));
  const changes=authoringChanges(files,{project,scene:project,files,sources:[],inactive:[],positions:{}},operation);
  if(changes.length!==1)throw new HttpError(409,'Use the transactional authoring endpoint for a multi-file edit');
  const file=changes[0]!;
  return {path:file.path,version:file.version,source:file.source,from:file.before,to:file.source};
}
export function previewCableEndpoint(workspace:Workspace,project:Project,id:string,end:'from'|'to',target:Endpoint):CableEndpointEdit {
  return preview(workspace,project,{kind:'endpoint',id,end,target:{device:target.device,port:target.port}});
}
export function previewCableDisconnect(workspace:Workspace,project:Project,id:string,end:'from'|'to',point:Point):CableEndpointEdit {
  return preview(workspace,project,{kind:'endpoint',id,end,target:point});
}

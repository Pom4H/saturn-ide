import { collectSignals, free, isAttached, type Equipment, type Pipe, type Cable, type Project } from '../core';
import type { PositionSource, Range } from '../source-edits';

export interface AuthoredFile { path: string; source: string; version: string }
export type AuthoredKind = 'equipment' | 'pipe' | 'cable' | 'alarm' | 'report' | 'hmi';
export interface SourceEntry {
  path: string;
  from: number;
  to: number;
  /** Real // token ranges, not a second enabled flag authored alongside the source. */
  comments: readonly Range[];
  declaration: boolean;
  expression: string;
}
export interface EntitySource extends SourceEntry { id: string; kind: AuthoredKind; enabled: boolean }
export interface InactiveEntity { source: EntitySource; value: Equipment | Pipe | Cable }
/** Disposable design-time information. Never serialized into BuildArtifact or installed in Runtime. */
export interface AuthoringFrame {
  project: Project;
  scene: Project;
  sources: readonly EntitySource[];
  inactive: readonly InactiveEntity[];
  positions: Record<string, PositionSource>;
  files: readonly AuthoredFile[];
}
export type AuthoringOperation =
  | { kind: 'enabled'; id: string; entity: AuthoredKind; enabled: boolean }
  | { kind: 'endpoint'; id: string; end: 'from' | 'to'; target: { device: string; port: string } | { x: number; y: number; z: number } };
export interface AuthoredChange { path: string; before: string; source: string; version: string }

/** Inactive entities retain their canonical shape. Only their design-time pose changes. */
export function inactiveScene(project: Project, inactive: readonly InactiveEntity[]): Project {
  const equipment = [...project.equipment];
  for (const { value, source } of inactive) if (source.kind === 'equipment' && 'ports' in value && !equipment.some(e => e.id === value.id)) equipment.push({ ...value, z: 0 });
  const floor = (edge: Pipe | Cable, end: 'from' | 'to') => {
    const tip = edge[end];
    if (!isAttached(tip)) return tip;
    const device = equipment.find(item => item.id === tip.device);
    // Put the dormant cable in the nearest clear aisle, derived from actual equipment bounds.
    const bottom = Math.max(0, ...equipment.map(item => item.y + (item.capabilities.diagram?.height ?? 150))) + 45;
    return free(tip, { x: (device?.x ?? 0) + tip.terminal.x, y: bottom + (end === 'to' ? 35 : 0), z: 0 });
  };
  const edges: (Pipe | Cable)[] = inactive.flatMap(({ value, source }) => source.kind !== 'equipment' && 'from' in value
    ? [{ ...value, from: floor(value, 'from'), to: floor(value, 'to') }] : []);
  // Scene uses the same Project/ConnectionEnd data. It is not an executable candidate and must not be applied.
  const scene = { ...project, equipment, pipes: [...project.pipes, ...edges.filter((edge): edge is Pipe => edge.kind === 'pipe')], cables: [...project.cables ?? [], ...edges.filter((edge): edge is Cable => edge.kind === 'cable')] };
  return {...scene, signals:collectSignals(scene)};
}

/** Shared transient scene projection for 2D and 3D hosts; never changes authored data. */
export function previewScene(frame:AuthoringFrame, poses:Readonly<Record<string,{x:number;y:number}>>, plug:{id:string;end:'from'|'to';x:number;y:number;z:number}|null):Project {
  const update=<T extends Pipe|Cable>(edge:T):T=>plug?.id===edge.id?{...edge,[plug.end]:free(edge[plug.end],{x:plug.x,y:plug.y,z:plug.z})}:edge;
  return {...frame.scene,equipment:frame.scene.equipment.map(e=>{
    const diagram=poses[e.id],mounted=poses[`mount:${e.id}`];
    return diagram||mounted?{...e,...(diagram?{x:diagram.x,y:diagram.y}:{}),...(mounted&&e.mount?{mount:{...e.mount,x:mounted.x,y:mounted.y}}:{})}:e;
  }),pipes:frame.scene.pipes.map(update),cables:frame.scene.cables?.map(update)};
}
export function readAuthoringOperation(value:unknown):AuthoringOperation {
  if(!value||typeof value!=='object'||!('id' in value)||typeof value.id!=='string'||value.id.length>80||!('kind' in value))throw new Error('Invalid source operation');
  if(value.kind==='enabled'&&'entity' in value&&typeof value.entity==='string'&&['equipment','pipe','cable','alarm','report','hmi'].includes(value.entity)&&'enabled' in value&&typeof value.enabled==='boolean')return {kind:'enabled',id:value.id,entity:value.entity as AuthoredKind,enabled:value.enabled};
  if(value.kind==='endpoint'&&'end' in value&&(value.end==='from'||value.end==='to')&&'target' in value&&value.target&&typeof value.target==='object'){
    const t=value.target;
    if('device' in t&&'port' in t&&typeof t.device==='string'&&typeof t.port==='string')return {kind:'endpoint',id:value.id,end:value.end,target:{device:t.device,port:t.port}};
    if('x' in t&&'y' in t&&'z' in t&&typeof t.x==='number'&&typeof t.y==='number'&&typeof t.z==='number'&&[t.x,t.y,t.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=15000)&&t.z>=0)return {kind:'endpoint',id:value.id,end:value.end,target:{x:t.x,y:t.y,z:t.z}};
  }
  throw new Error('Unsupported source operation');
}
export function readAuthoredFiles(value:unknown):AuthoredFile[] {
  if(!Array.isArray(value)||value.length>64)throw new Error('Invalid document list');
  const files:AuthoredFile[]=value.map((file:unknown)=>{
    if(!file||typeof file!=='object'||!('path' in file)||!('source' in file)||!('version' in file)||typeof file.path!=='string'||typeof file.source!=='string'||typeof file.version!=='string'||file.path.length>512||file.source.length>256000||file.version.length>256)throw new Error('Invalid authored file');
    return {path:file.path,source:file.source,version:file.version};
  });
  if(new Set(files.map(file=>file.path)).size!==files.length||files.reduce((n,f)=>n+f.source.length,0)>1000000)throw new Error('Duplicate or excessive files');return files;
}

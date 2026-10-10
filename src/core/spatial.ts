import type { Equipment, Medium, Point, Project, Text } from '../core';

/** @ru Точка трассы в координатах проекта. Без z сохраняет прежнюю автоматическую высоту.
 * @en World-space route waypoint. Omitted z retains the legacy automatic route elevation. */
export interface RoutePoint { readonly x:number; readonly y:number; readonly z?:number; readonly kind?:never }
/** @ru Именованный проход через помещение, не электрический/гидравлический узел соединения.
 * @en Named room passage, not an electrical or hydraulic junction. */
export interface RoutePort<M extends Medium=Medium> {
  readonly kind:'route-port'; readonly system:string; readonly port:string; readonly medium:M;
}
/** @ru X/Y — план проекта, Z — высота над полом помещения, в единицах схемы.
 * @en X/Y are project-plan coordinates; Z is relative to the room floor, in diagram units. */
export interface SystemPortSpec extends Point { readonly medium:Medium; readonly label?:Text }
export interface SystemPort<M extends Medium=Medium> extends RoutePort<M> {
  readonly position:Readonly<Point>; readonly label?:Text;
}
export type RouteWaypoint<M extends Medium=Medium> = RoutePoint | RoutePort<M>;
export type SystemPorts<P extends Readonly<Record<string,SystemPortSpec>>,I extends string> = {
  readonly [K in keyof P]:SystemPort<P[K]['medium']> & {readonly system:I;readonly port:Extract<K,string>}
};

/** Strip convenience declaration geometry from connection references: the system owns it once. */
export function routeReferences<M extends Medium>(points:readonly RouteWaypoint<M>[]|undefined):readonly RouteWaypoint<M>[]|undefined {
  return points?.map(point=>point.kind==='route-port'
    ? {kind:'route-port',system:point.system,port:point.port,medium:point.medium}
    : {...point});
}

/** @ru Абсолютная отметка пола с учётом родителей; отсутствие z означает 0.
 * @en Absolute floor elevation, accumulating parent offsets; omitted z means zero. */
export function systemElevation(project:Pick<Project,'systems'>,id?:string):number {
  let elevation=0;
  const seen=new Set<string>();
  while(id!==undefined){
    const group=project.systems?.find(group=>group.id===id);
    if(!group||seen.has(id))throw new Error(`Unknown/cyclic system ${id}`);
    seen.add(id);elevation+=group.z??0;id=group.parent;
  }
  return elevation;
}
/** The same base elevation is used for meshes, terminals, instrument mounts and drag planes. */
export const equipmentElevation=(project:Pick<Project,'systems'>,equipment:Pick<Equipment,'system'|'z'>):number=>
  systemElevation(project,equipment.system)+(equipment.z??0);

/** Resolve a symbolic passage against its current declaration, never a stale embedded position. */
export function waypointPosition(project:Pick<Project,'systems'>,point:RouteWaypoint,automaticZ=0):Point {
  if(point.kind!=='route-port')return {x:point.x,y:point.y,z:point.z??automaticZ};
  const port=project.systems?.find(group=>group.id===point.system)?.ports?.[point.port];
  if(!port||port.medium!==point.medium)throw new Error(`Unknown/incompatible route port ${point.system}.${point.port}`);
  return {x:port.position.x,y:port.position.y,z:systemElevation(project,point.system)+port.position.z};
}
/** Derived positions for 2D/3D projections; no second authored port registry. */
export function systemPortPositions(project:Pick<Project,'systems'>):readonly {port:SystemPort;point:Point}[] {
  return (project.systems??[]).flatMap(group=>Object.values(group.ports??{}).map(port=>({port,point:waypointPosition(project,port)})));
}

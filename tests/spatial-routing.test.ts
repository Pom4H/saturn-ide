import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import {
  cable, device, equipmentElevation, free, pipe, project, ProjectError, signal,
  system, systemElevation, systemPortPositions, terminal, validateProject, waypointPosition,
  type Point, type Project, type RoutePort, type RouteWaypoint,
} from '../src/core';
import { createArtifact, digest } from '../src/core/artifact';
import { decodeProject } from '../src/core/project-codec';
import { systemLayout } from '../src/core/system-layout';
import { anchor, routeConnection, routeConnections, routingWaypoints } from '../src/topology';
import { roundedRoute } from '../src/shell/route3d';
import { roundedPipePath } from '../src/shell/pipe-path';
import { graphImpact, semanticDiff, semanticGraph } from '../src/semantic';

const unit=device({id:'spatial-unit',icon:'pump',capabilities:{diagram:{width:80,height:80}},ports:{
  out:terminal({x:80,y:40,z:20,side:'right',medium:'fluid',family:'water',role:'source',max:16}),
  in:terminal({x:0,y:40,z:20,side:'left',medium:'fluid',family:'water',role:'sink',max:16}),
  powerOut:terminal({x:80,y:65,z:40,side:'right',medium:'power',family:'24v',role:'source',max:16}),
  powerIn:terminal({x:0,y:65,z:40,side:'left',medium:'power',family:'24v',role:'sink',max:16}),
}});
const fixture=()=>{
  const floor=system('floor',{label:'Second floor',z:300});
  const room=system('room',{label:'Pump room',parent:floor.id,z:20,ports:{
    water:{medium:'fluid',x:400,y:80,z:120,label:'Water passage'},
    power:{medium:'power',x:450,y:60,z:160},
  }});
  const from=unit('A',{label:'Source',system:room.id,x:0,y:200,z:5});
  const to=unit('B',{label:'Destination',system:room.id,x:800,y:300,z:15});
  const flow=signal('flow',{initial:5,unit:'m³/h'});
  const water=pipe('water',{from:from.ports.out,to:to.ports.in,flow,via:[room.ports.water]});
  const power=cable('power',{from:from.ports.powerOut,to:to.ports.powerIn,via:[room.ports.power]});
  const model=project({id:'spatial',label:'Spatial fixture',systems:[floor,room],equipment:[from,to],pipes:[water],cables:[power]});
  return {floor,room,from,to,flow,water,power,model};
};
/** The route must visit these points in order, including their elevation. */
function visits(points:readonly Point[],waypoints:readonly Point[]):boolean {
  let distance=0;
  for(const p of waypoints){
    let walked=0,found=false;
    for(let i=1;i<points.length;i++){
      const a=points[i-1]!,b=points[i]!,length=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
      const left=Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z),right=Math.hypot(b.x-p.x,b.y-p.y,b.z-p.z);
      if(Math.abs(left+right-length)<1e-7&&walked+left>=distance-1e-7){distance=walked+left;found=true;break;}
      walked+=length;
    }
    if(!found)return false;
  }
  return true;
}
function assertRoute(model:Project,id:string){
  const edge=[...model.pipes,...model.cables??[]].find(edge=>edge.id===id)!;
  const route=routeConnection(model,edge);
  expect(route.valid).toBe(true);
  expect(route.points[0]).toEqual(anchor(model,edge.from));
  expect(route.points.at(-1)).toEqual(anchor(model,edge.to));
  expect(visits(route.points,routingWaypoints(model,edge))).toBe(true);
  for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1]!,b=route.points[i]!;
    expect([a.x!==b.x,a.y!==b.y,a.z!==b.z].filter(Boolean)).toHaveLength(1);
  }
  return route;
}

test('room floors, equipment and canonical endpoint anchors share one accumulated elevation',()=>{
  const {model,room,from}=fixture();
  expect(systemElevation(model,room.id)).toBe(320);
  expect(equipmentElevation(model,from)).toBe(325);
  expect(anchor(model,from.ports.out)).toEqual({x:80,y:240,z:345});
  expect(waypointPosition(model,room.ports.water)).toEqual({x:400,y:80,z:440});
  expect(systemLayout(model).find(group=>group.id==='room')!.z).toBe(320);
  expect(systemPortPositions(model).map(({point})=>point.z)).toEqual([440,480]);
});

test('pipes and cables pass through their exact XYZ room ports without adding equipment or junctions',()=>{
  const {model,water}=fixture();
  expect(water.via).toEqual([{kind:'route-port',system:'room',port:'water',medium:'fluid'}]);
  assertRoute(model,'water');assertRoute(model,'power');
  expect(model.equipment).toHaveLength(2);
  expect(Object.keys(model.signals)).toEqual(['flow']);
  const second=pipe('water-2',{from:model.equipment[0]!.ports.out!,to:model.equipment[1]!.ports.in!,flow:model.pipes[0]!.flow,via:water.via as readonly RouteWaypoint<'fluid'>[]});
  // Sharing an opening is geometry only; two separate pipes stay separate edges.
  validateProject({...model,pipes:[...model.pipes,second]});
});

test('explicit XYZ waypoints preserve risers, descents, same-XY points and author order',()=>{
  const {model,water}=fixture();
  const via=[{x:200,y:50,z:220},{x:200,y:50,z:620},{x:600,y:50,z:620},{x:600,y:50,z:-40}];
  const changed={...model,pipes:[{...water,via}]};
  validateProject(changed);const route=assertRoute(changed,'water');
  expect(visits(route.points,via)).toBe(true);
});

test('legacy groups and XY-only routing retain zero floors and automatic route height',()=>{
  expect(system('old',{en:'Old',ru:'Старый'},'parent')).toEqual({id:'old',label:{en:'Old',ru:'Старый'},parent:'parent'});
  const {model,water}=fixture();
  const legacy={...model,systems:[system('floor','Floor'),system('room','Room','floor')],pipes:[{...water,via:[{x:400,y:80}]}],cables:[]};
  const route=assertRoute(legacy,'water');
  expect(routingWaypoints(legacy,legacy.pipes[0]!)).toEqual([{x:400,y:80,z:35}]);
  expect(Math.max(...route.points.map(p=>p.z))).toBe(35);
  expect(system('empty',{label:'Empty'}).ports).toEqual({});
});

test('moving a passage or a parent floor invalidates cached routes without stale embedded geometry',()=>{
  const {model}=fixture(),routes=routeConnections(model);
  const changed={...model,systems:model.systems.map(group=>group.id==='room'?{
    ...group,ports:{...group.ports,water:{...model.systems[1]!.ports.water,position:{x:460,y:20,z:200}}},
  }:group)};
  const next=routeConnections(changed,{project:model,routes});
  const edge=changed.pipes[0]!;
  expect(next[0]).not.toBe(routes[0]);
  expect(visits(next[0]!.points,routingWaypoints(changed,edge))).toBe(true);
  expect(waypointPosition(changed,edge.via![0]!)).toEqual({x:460,y:20,z:520});
  const lifted={...model,systems:model.systems.map(group=>group.id==='floor'?{...group,z:600}:group)};
  const liftedRoutes=routeConnections(lifted,{project:model,routes});
  for(let i=0;i<routes.length;i++)expect(liftedRoutes[i]!.points).toEqual(routes[i]!.points.map(point=>({...point,z:point.z+300})));
  const unrelated={...model,systems:[...model.systems,system('unrelated',{label:'Other',z:900})]};
  expect(routeConnections(unrelated,{project:model,routes})[0]).toBe(routes[0]);
});

test('endpoint drags keep named waypoints exact on every preview frame',()=>{
  const {model}=fixture();let previous:Project=model,routes=routeConnections(model);
  for(let i=1;i<=30;i++){
    const next={...model,equipment:model.equipment.map(e=>e.id==='B'?{...e,x:e.x+i,y:e.y+i/2}:e)};
    routes=routeConnections(next,{project:previous,routes});
    expect(routes.every(route=>route.valid)).toBe(true);
    for(const route of routes){const edge=[...next.pipes,...next.cables].find(edge=>edge.id===route.id)!;expect(visits(route.points,routingWaypoints(next,edge))).toBe(true);}
    previous=next;
  }
});

test('passage-only rooms produce envelopes and all spatial fields survive immutable artifact transport',async()=>{
  const {model,room}=fixture();
  const empty=project({id:'ports-only',label:'Ports only',systems:[system('room',{label:'Empty room',z:100,ports:{water:{medium:'fluid',x:10,y:20,z:30}}})]});
  expect(systemLayout(empty)).toHaveLength(1);expect(systemLayout(empty)[0]!.count).toBe(0);
  const hash=await digest('spatial-test');
  const artifact=await createArtifact(model,null,{sourceRevision:null,sourceDigest:hash,coreHash:hash,lockHash:null,bunVersion:Bun.version});
  const decoded=decodeProject(artifact.model);
  expect(decoded.systems).toEqual(model.systems);expect(decoded.pipes[0]!.via).toEqual(model.pipes[0]!.via);
  expect(Object.isFrozen(decoded.systems![1]!.ports!.water!.position)).toBe(true);
  expect(waypointPosition(decoded,room.ports.water)).toEqual(waypointPosition(model,room.ports.water));
  assertRoute(decoded,'water');assertRoute(decoded,'power');
});

test('invalid coordinates, hierarchy, passage identity and medium fail at the model boundary',()=>{
  const {model}=fixture();
  for(const z of [NaN,Infinity,-Infinity,15001])expect(()=>validateProject({...model,systems:[{...model.systems[0]!,z},model.systems[1]!]})).toThrow(ProjectError);
  for(const z of [NaN,Infinity,15001])expect(()=>validateProject({...model,pipes:[{...model.pipes[0]!,via:[{x:20,y:40,z}]}]})).toThrow(ProjectError);
  expect(()=>validateProject({...model,systems:[{...model.systems[0]!,z:14900},{...model.systems[1]!,z:200}]})).toThrow(ProjectError);
  expect(()=>validateProject({...model,systems:[{...model.systems[0]!,parent:'room'},model.systems[1]!]})).toThrow(ProjectError);
  const ref:RoutePort={kind:'route-port',system:'room',port:'missing',medium:'fluid'};
  expect(()=>validateProject({...model,pipes:[{...model.pipes[0]!,via:[ref]}]})).toThrow(ProjectError);
  expect(()=>validateProject({...model,pipes:[{...model.pipes[0]!,via:[model.systems[1]!.ports.power]}]})).toThrow(ProjectError);
  expect(()=>validateProject({...model,systems:[model.systems[0]!,{...model.systems[1]!,ports:{water:{...model.systems[1]!.ports.water,system:'other'}}}]})).toThrow(ProjectError);
});

test('a basement free end keeps its negative world elevation',()=>{
  const {model}=fixture();
  const basement={...model,systems:model.systems.map(group=>group.id==='floor'?{...group,z:-400}:group)};
  const end=free(model.equipment[1]!.ports.in!,{x:500,y:0,z:-200});
  const changed={...basement,pipes:[{...model.pipes[0]!,to:end}]};
  validateProject(changed);const route=assertRoute(changed,'water');
  expect(route.points.at(-1)!.z).toBe(-200);
});

test('rounding cannot cut an authored passage corner in either renderer',()=>{
  const points=[{x:0,y:0,z:10},{x:40,y:0,z:10},{x:40,y:40,z:10},{x:80,y:40,z:10}];
  expect(roundedPipePath(points,8,[points[1]!])).toStartWith('M0 0L40 0');
  const vectors=points.map(p=>new Vector3(p.x,p.z,p.y));
  const rounded=roundedRoute(vectors,12,[vectors[1]!]);
  expect(rounded.bends).toBe(1);
  expect(rounded.path.curves.some(curve=>curve.getPoint(1).equals(vectors[1]!))).toBe(true);
});

test('spatial source changes are visible to semantic review and passage-dependent routes',()=>{
  const {model}=fixture();
  const changed={...model,systems:model.systems.map(group=>group.id==='floor'?{...group,z:450}:group)};
  const changes=semanticDiff(model,changed).map(change=>change.semanticId);
  expect(changes).toContain('system:floor');expect(changes).toContain('system:room');
  expect(changes).toContain('equipment:A');expect(changes).toContain('connection:water');
  expect(graphImpact(semanticGraph(model),'system:room')!.direct.map(node=>node.id)).toContain('water');
});

// Compiled with the normal dual TypeScript check, not executed as runtime invalid input.
function typeAssertions(){
  const {room,from,to,flow}=fixture();
  const name:'water'=room.ports.water.port;void name;
  // @ts-expect-error A power opening cannot carry a fluid pipe.
  pipe('bad',{from:from.ports.out,to:to.ports.in,flow,via:[room.ports.power]});
  // @ts-expect-error A fluid opening cannot carry a power cable.
  cable('bad',{from:from.ports.powerOut,to:to.ports.powerIn,via:[room.ports.water]});
  // @ts-expect-error Port names are inferred, not an untyped string map.
  room.ports.missing;
  // @ts-expect-error A route passage is not an equipment connection endpoint.
  pipe('bad',{from:room.ports.water,to:to.ports.in,flow});
}


test('collinear passages near a bend survive compaction and rendered bend insets',()=>{
  const {model,water}=fixture();
  const fixed=[{x:200,y:50,z:400},{x:202,y:50,z:400},{x:240,y:50,z:400},{x:240,y:90,z:400}];
  const changed={...model,pipes:[{...water,via:fixed}]};
  const route=assertRoute(changed,'water');
  for(const point of fixed)expect(route.points).toContainEqual(point);
  const vector=(p:Point)=>new Vector3(p.x,p.z,p.y);
  const {path}=roundedRoute(route.points.map(vector),12,fixed.map(vector));
  for(const point of fixed)expect(path.curves.some(curve=>curve.getPoint(0).equals(vector(point))||curve.getPoint(1).equals(vector(point)))).toBe(true);
});


test('explicit passages do not force an unrelated high-level detour before the first opening',()=>{
  const {model,water}=fixture();
  const opening={x:200,y:50,z:220};
  const changed={...model,pipes:[{...water,via:[opening]}]};
  const route=assertRoute(changed,'water');
  const index=route.points.findIndex(p=>p.x===opening.x&&p.y===opening.y&&p.z===opening.z);
  expect(index).toBeGreaterThan(0);
  const start=anchor(changed,water.from);
  expect(route.points.slice(0,index+1).every(p=>p.z>=opening.z&&p.z<=start.z)).toBe(true);
});

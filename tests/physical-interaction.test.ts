import { test } from 'node:test';
import assert from 'node:assert/strict';
import { free, type Equipment, type Pipe, type Cable, type Point, type Project } from '../src/core';
import { connectionTip, routeConnections, type PhysicalRoute } from '../src/topology';
import { geometryRevision } from '../src/shell/model/geometry-revision';

function fixture(kind:'pipe'|'cable'='pipe',y=-9):Project {
  const device=(id:string,x:number,y:number,width:number,height:number,side?:'left'|'right'):Equipment=>({
    id,kind:'fixture',icon:'pump',label:id,x,y,ports:side?{port:{device:id,port:'port',terminal:{x:side==='right'?width:0,y:height/2,z:0,side,medium:kind==='pipe'?'fluid':'control',family:kind==='pipe'?'water':'digital',role:side==='right'?'source':'sink',max:1}}}:{},
    capabilities:{diagram:{width,height}},knowledge:{},alarms:[],
  });
  const a=device('A',100,y,100,100,'right'),b=device('B',700,100,100,100,'left'),obstacle=device('obstacle',400,10,140,200);
  const flow={id:'flow',initial:1},base={id:'line',from:a.ports.port!,to:b.ports.port!};
  const pipe:Pipe={...base,kind:'pipe',flow},cable:Cable={...base,kind:'cable'};
  return {id:'fixture',label:'Physical editing',equipment:[a,b,obstacle],pipes:kind==='pipe'?[pipe]:[],cables:kind==='cable'?[cable]:[],signals:{flow},alarms:[]};
}
function yAt(route:PhysicalRoute,x:number):number {
  for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1]!,b=route.points[i]!;
    if(a.x!==b.x&&x>=Math.min(a.x,b.x)&&x<=Math.max(a.x,b.x))return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);
  }
  throw new Error('No route at the probe section');
}
function hasPoint(route:PhysicalRoute,p:{x:number;y:number}):boolean {
  return route.points.slice(1).some((b,i)=>{const a=route.points[i]!;return a.x===b.x&&a.x===p.x&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y)||a.y===b.y&&a.y===p.y&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x);});
}
function noRetracing(points:readonly Point[]):boolean {
  return points.slice(2).every((c,i)=>{const a=points[i]!,b=points[i+1]!;return (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)+(b.z-a.z)*(c.z-b.z)>=0;});
}
for(const kind of ['pipe','cable'] as const){
  test(`${kind}: a one-unit drag retains the clear corridor in both directions`,()=>{
    const before=fixture(kind),routes=routeConnections(before),after=fixture(kind,-8),source=JSON.stringify(before);
    assert.equal(routes[0]!.valid,true);
    const moved=routeConnections(after,{project:before,routes});
    assert.equal(moved[0]!.valid,true);
    assert.equal(yAt(moved[0]!,470),yAt(routes[0]!,470));
    assert.equal(moved[0]!.points[0]!.y-routes[0]!.points[0]!.y,1);
    const back=routeConnections(before,{project:after,routes:moved});
    assert.equal(yAt(back[0]!,470),yAt(routes[0]!,470));
    assert.equal(JSON.stringify(before),source);
  });
  test(`${kind}: repeated drag repairs do not backtrack or grow without bound`,()=>{
    let previous={project:fixture(kind,-50),routes:[] as PhysicalRoute[]};previous.routes=routeConnections(previous.project);
    for(let y=-49;y<100;y++){
      const project=fixture(kind,y),routes=routeConnections(project,previous);
      assert.equal(routes[0]!.valid,true);assert.equal(noRetracing(routes[0]!.points),true);assert(routes[0]!.points.length<20);
      previous={project,routes};
    }
  });
  test(`${kind}: unrelated geometry does not replace a clear cached route`,()=>{
    const project=fixture(kind),routes=routeConnections(project),far={...project.equipment[2]!,id:'far',x:2000,y:2000};
    const next={...project,equipment:[...project.equipment,far]};
    assert.equal(routeConnections(next,{project,routes})[0],routes[0]);
  });
}
test('an obstacle entering the retained corridor forces real replanning',()=>{
  const project=fixture(),routes=routeConnections(project),extra={...project.equipment[2]!,id:'new-obstacle',x:490,y:-80,capabilities:{diagram:{width:40,height:60}}};
  const next={...project,equipment:[...project.equipment,extra]},moved=routeConnections(next,{project,routes});
  assert.equal(moved[0]!.valid,true);assert.notDeepEqual(moved[0]!.points,routes[0]!.points);
});
test('retargeting preserves ordered authored routing waypoints',()=>{
  const project=fixture(),via=[{x:300,y:-100},{x:600,y:-100}];project.pipes[0]={...project.pipes[0]!,via};
  const routes=routeConnections(project),next={...project,equipment:project.equipment.map(e=>e.id==='A'?{...e,y:e.y+1}:e)},moved=routeConnections(next,{project,routes});
  assert.equal(moved[0]!.valid,true);for(const point of via)assert.equal(hasPoint(moved[0]!,point),true);
});
test('a translated and elevated device exposes a world-space connection tip',()=>{
  const project=fixture('cable');project.equipment[0]={...project.equipment[0]!,x:1000,y:200,z:300};
  assert.deepEqual(connectionTip(project,project.cables![0]!,'from'),{x:1100,y:250,z:300});
});
test('a loose cable end keeps its authored world-space height and placement',()=>{
  const project=fixture('cable'),at={x:650,y:260,z:40};project.cables![0]={...project.cables![0]!,to:free(project.cables![0]!.to,at)};
  assert.deepEqual(connectionTip(project,project.cables![0]!,'to'),at);
  const routes=routeConnections(project);assert.equal(routes[0]!.valid,true);assert.deepEqual(routes[0]!.points.at(-1),at);
  assert(routes[0]!.points.length>2);
});
test('a loose end placed inside equipment is not reported as a valid straight cable',()=>{
  const project=fixture('cable');project.cables![0]={...project.cables![0]!,to:free(project.cables![0]!.to,{x:450,y:100,z:0})};
  assert.equal(routeConnections(project)[0]!.valid,false);
});
test('3D geometry identity ignores placement, but retains definition and port changes',()=>{
  const project=fixture(),revision=geometryRevision(project,'edit');
  const moved={...project,equipment:project.equipment.map(e=>({...e,x:e.x+100,y:e.y-100,z:300}))};
  assert.equal(geometryRevision(moved,'edit'),revision);
  assert.notEqual(geometryRevision(project,'select'),revision);
  const changed={...project,equipment:project.equipment.map(e=>e.id==='A'?{...e,capabilities:{diagram:{width:300,height:100}}}:e)};
  assert.notEqual(geometryRevision(changed,'edit'),revision);
});

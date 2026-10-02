import { expect, test } from 'bun:test';
import { pipe, project, pump, signal, tank, tee, valve } from '../src/core';
import { routeConnections } from '../src/topology';

test('tee is one explicit three-port topology node for split and merge', () => {
  const source=tank('TK-S',{label:'Source',x:0,y:180});
  const split=tee('T-S',{label:'Split tee',x:300,y:180});
  const a=valve('V-A',{label:'Branch A',x:620,y:80});
  const b=valve('V-B',{label:'Branch B',x:620,y:300});
  const q0=signal('q0',{initial:30}),q1=signal('q1',{initial:12}),q2=signal('q2',{initial:18});
  const splitProject=project({
    id:'tee-split',label:'Tee split',equipment:[source,split,a,b],
    pipes:[
      pipe('feed',{from:source.ports.outlet,to:split.ports.left,flow:q0}),
      pipe('branch-a',{from:split.ports.right,to:a.ports.inlet,flow:q1}),
      pipe('branch-b',{from:split.ports.branch,to:b.ports.inlet,flow:q2}),
    ],
  });
  const routes=routeConnections(splitProject);
  expect(routes).toHaveLength(3);
  expect(routes.every(route=>route.valid)).toBe(true);
  expect(new Set(splitProject.pipes.flatMap(edge=>[edge.from,edge.to]).filter(end=>!('kind' in end)&&end.device==='T-S').map(end=>!('kind' in end)?end.port:''))).toEqual(new Set(['left','right','branch']));

  const left=tank('TK-L',{label:'Left source',x:0,y:80});
  const branch=tank('TK-B',{label:'Branch source',x:260,y:-300});
  const merge=tee('T-M',{label:'Merge tee',x:360,y:220});
  const sink=pump('P-M',{label:'Sink',x:680,y:200});
  const inA=signal('merge.a',{initial:7}),inB=signal('merge.b',{initial:5}),out=signal('merge.out',{initial:12});
  const mergeProject=project({
    id:'tee-merge',label:'Tee merge',equipment:[left,branch,merge,sink],
    pipes:[
      pipe('in-a',{from:left.ports.outlet,to:merge.ports.left,flow:inA}),
      pipe('in-b',{from:branch.ports.outlet,to:merge.ports.branch,flow:inB}),
      pipe('out',{from:merge.ports.right,to:sink.ports.inlet,flow:out}),
    ],
  });
  const mergeRoutes=routeConnections(mergeProject);
  expect(mergeRoutes.filter(route=>!route.valid).map(route=>({id:route.id,error:route.error}))).toEqual([]);

  expect(()=>project({
    id:'tee-occupied',label:'Occupied tee',equipment:[left,branch,merge,sink],
    pipes:[
      pipe('occupied-a',{from:left.ports.outlet,to:merge.ports.left,flow:inA}),
      pipe('occupied-b',{from:branch.ports.outlet,to:merge.ports.left,flow:inB}),
    ],
  })).toThrow(/Port occupied/);
});

if(false){
  const v=valve('V-TYPE',{label:'Valve',x:0,y:0}),j=tee('T-TYPE',{label:'Tee',x:200,y:0}),flow=signal('type-flow',{initial:0});
  // @ts-expect-error a sink remains illegal as a pipe source even though passive tee ends are bidirectional fittings
  pipe('wrong-direction',{from:v.ports.inlet,to:j.ports.left,flow});
}

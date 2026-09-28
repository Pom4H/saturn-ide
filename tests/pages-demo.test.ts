import { expect, test } from 'bun:test';
import { parseDemoSource, starterSource, updateDemoValue, buildDemo, demoSnapshot } from '../site/demo';
import { routeConnections } from '../src/topology';

test('landing preview reads authored signal literals and builds Saturn equipment and fluid topology',()=>{
  const values=parseDemoSource(starterSource),project=buildDemo(values),routes=routeConnections(project),snapshot=demoSnapshot(project,values,1000);
  expect(values).toEqual({level:68,rpm:1460,run:true,opening:72});
  expect(project.equipment.map(item=>item.id)).toEqual(['TK-01','P-01','V-01']);
  expect(project.pipes.map(item=>item.id)).toEqual(['suction','discharge']);
  expect(routes).toHaveLength(2);expect(routes.every(route=>route.valid)).toBe(true);
  expect(snapshot.samples['TK-01.level']?.value).toBe(68);
  expect(snapshot.samples['P-01.flow']?.quality).toBe('good');
});

test('visual controls edit authored source and source edits become visual model state',()=>{
  const controlEdited=updateDemoValue(starterSource,'opening',0),closed=parseDemoSource(controlEdited),closedSnapshot=demoSnapshot(buildDemo(closed),closed,1000);
  expect(controlEdited).toContain("opening: signal({ initial: 0, unit: '%'");
  expect(closed.opening).toBe(0);expect(closedSnapshot.samples['P-01.flow']?.value).toBe(0);
  const sourceEdited=starterSource.replace("initial: 68, unit: '%', min: 0, max: 100", "initial: 31, unit: '%', min: 0, max: 100");
  const changed=parseDemoSource(sourceEdited),project=buildDemo(changed),sample=demoSnapshot(project,changed,1000).samples['TK-01.level'];
  expect(changed.level).toBe(31);expect(sample?.value).toBe(31);
  expect(()=>parseDemoSource(sourceEdited.replace('initial: 31','initial: 101'))).toThrow();
});

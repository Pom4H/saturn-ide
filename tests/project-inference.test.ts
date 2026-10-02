import { expect, test } from 'bun:test';
import {
  alarm, cable, column, command, device, expectRange, expectValue, hmi,
  monitor, monitorMetric, pipe, plc, project, pump, report, reportColumn,
  reportField, reportSchema, scenario, set, signal, tank, type Project, type ProjectDefinition, type Signal,
} from '../src/core';
import { canonical } from '../src/core/artifact';
import { decodeProject } from '../src/core/project-codec';

const sensorType=device({id:'sensor',icon:'sensor',ports:{},signals:{
  pressure:signal({initial:0,unit:'bar'}), enabled:signal({initial:false,writable:true}),
}});
const sensor=sensorType('PT',{label:'Pressure',x:0,y:0});
const alternative=sensorType('OTHER',{label:'Alternative',x:0,y:0});
const conditional=(primary:boolean)=>project({id:'conditional',label:'Conditional',equipment:[primary?sensor:alternative]});
const reservoir=tank('TK',{label:'Tank',x:100,y:0});
const booster=pump('P',{label:'Pump',x:300,y:0});
const controller=plc('PLC',{label:'Controller',x:500,y:0});
const flow=signal('pipeOnly',{initial:0,unit:'m³/h'});
const start=signal('cableOnly',{initial:false,writable:true});
const pressure=signal('alarmOnly',{initial:0});
const status=signal('reportOnly',{initial:'ready'});
const sql=signal('sqlOnly',{initial:0});
const monitored=signal('monitorOnly',{initial:0});
const automatic=signal('scenarioOnly',{initial:false,writable:true});
const display=signal('screenOnly',{initial:'ready'});
const display2=signal('screen2Only',{initial:0});
const schema=reportSchema({value:reportField(sql)});
const plant=project({id:'inference',label:'Inference',equipment:[sensor,reservoir,booster,controller],
  pipes:[pipe('water',{from:reservoir.ports.outlet,to:booster.ports.inlet,flow})],
  cables:[cable('start',{from:controller.ports.DO1,to:booster.ports.run,signal:start})],
  alarms:[alarm('high',{label:'High',signal:pressure,above:5})],
  reports:[report('status',{label:'Status',bucketMs:1000,columns:{status:column(status,'last','State')}}),
    report('sql',{label:'SQL',sql:'SELECT 1 AS value',schema,signals:[sql],window:1000,columns:[reportColumn('Value',schema.value)]})],
  monitoring:[monitor('health',{label:'Health',metrics:[monitorMetric('measured',monitored,{warning:{above:5}})]})],
  scenarios:[scenario('test',{label:'Test',timeoutMs:10000,steps:[set(automatic,true),expectValue(automatic,true),expectRange(pressure,0,10)]})],
  hmi:{width:200,height:100,equipment:[],elements:[{id:'status',kind:'text',text:'%VALUE',x:0,y:0,width:100,height:20,signal:display}]},
  hmis:[hmi('detail',{width:200,height:100,equipment:[],elements:[{id:'reading',kind:'text',text:'%VALUE',x:0,y:0,width:100,height:20,signal:display2}]})],
});

test('omitted collections materialize one valid empty Project and remain independently allocated',()=>{
  const first:Project=project({id:'empty',label:'Empty'}),second=project({id:'other',label:'Other'});
  expect(first.equipment).toEqual([]);expect(first.pipes).toEqual([]);expect(first.alarms).toEqual([]);expect(first.signals).toEqual({});
  expect(first.equipment).not.toBe(second.equipment);expect(first.pipes).not.toBe(second.pipes);
  expect(project({id:'equipment-only',label:'Equipment',equipment:[sensor]}).signals['PT.pressure']).toBe(sensor.pressure);
  expect(decodeProject(canonical(first))).toEqual(first);
  expect(canonical(first)).toBe(canonical(project({id:'empty',label:'Empty',equipment:[],pipes:[],alarms:[]})));
  for(const field of ['equipment','pipes','alarms']){
    expect(()=>project({id:'invalid',label:'Invalid',[field]:null} as unknown as ProjectDefinition)).toThrow('Invalid project collections');
  }
});

test('conditional equipment does not promise both sets of signals',()=>{
  const selected=conditional(false);
  expect(selected.signals['PT.pressure']).toBeUndefined();
  expect(selected.signals['OTHER.pressure']).toBe(alternative.pressure);
});

test('inferred index collects exactly the canonical references from every supported source',()=>{
  for(const source of [sensor.pressure,sensor.enabled,flow,start,pressure,status,sql,monitored,automatic,display,display2]){
    expect(plant.signals[source.id]).toBe(source);
  }
  expect(Object.keys(plant.signals).sort()).toEqual([
    'PT.pressure','PT.enabled','TK.level','P.rpm','P.run','PLC.online',
    'pipeOnly','cableOnly','alarmOnly','reportOnly','sqlOnly','monitorOnly','scenarioOnly','screenOnly','screen2Only',
  ].sort());
  const explicit=signal('actual.id',{initial:0});
  const indexed=project({id:'explicit',label:'Explicit',signals:{alias:explicit},equipment:[sensor]});
  expect(indexed.signals['actual.id']).toBe(explicit);
  expect(Object.hasOwn(indexed.signals,'alias')).toBe(false);
  expect(indexed.signals['PT.pressure']).toBe(sensor.pressure);
  expect(()=>project({id:'conflict',label:'Conflict',signals:{a:explicit,b:signal('actual.id',{initial:1})}})).toThrow('Conflicting signal ID');
});

// Both TypeScript compilers and the real workspace language test check these assertions.
if(false){
  const measured:Signal<number,'PT.pressure',false>=plant.signals['PT.pressure'];
  const enabled:Signal<boolean,'PT.enabled',true>=plant.signals['PT.enabled'];
  const fromPipe:Signal<number,'pipeOnly',false>=plant.signals.pipeOnly;
  const fromCable:Signal<boolean,'cableOnly',true>=plant.signals.cableOnly;
  const fromAlarm:Signal<number,'alarmOnly',false>=plant.signals.alarmOnly;
  const fromReport:Signal<string,'reportOnly',false>=plant.signals.reportOnly;
  const fromSql:Signal<number,'sqlOnly',false>=plant.signals.sqlOnly;
  const fromMonitor:Signal<number,'monitorOnly',false>=plant.signals.monitorOnly;
  const fromScenario:Signal<boolean,'scenarioOnly',true>=plant.signals.scenarioOnly;
  const fromScreen:Signal<string,'screenOnly',false>=plant.signals.screenOnly;
  const fromScreen2:Signal<number,'screen2Only',false>=plant.signals.screen2Only;
  command(enabled,true);command(fromCable,false);command(fromScenario,true);
  set<boolean>(automatic,true);expectValue<boolean>(automatic,true);
  void [measured,fromPipe,fromAlarm,fromReport,fromSql,fromMonitor,fromScreen,fromScreen2];
  // @ts-expect-error A finite authored graph has no invented signal key.
  plant.signals.missing;
  // @ts-expect-error Numeric measurement remains read-only through the project index.
  command(plant.signals['PT.pressure'],1);
  // @ts-expect-error Boolean writable output rejects a numeric command.
  command(plant.signals['PT.enabled'],1);
  // @ts-expect-error Report-only source remains a string signal.
  const wrong:number=plant.signals.reportOnly.initial;
  void wrong;
  const explicit=project({id:'aliases',label:'Aliases',signals:{alias:signal('real.id',{initial:true})}});
  const actual:Signal<boolean,'real.id',false>=explicit.signals['real.id'];void actual;
  // @ts-expect-error Explicit input aliases are not keys in the canonical ID index.
  explicit.signals.alias;
  const selected=conditional(false);
  const possible:Signal<number,'PT.pressure',false>|undefined=selected.signals['PT.pressure'];void possible;
  // @ts-expect-error A conditional source may not exist in the materialized project.
  const invented:Signal<number,'PT.pressure',false>=selected.signals['PT.pressure'];void invented;
}

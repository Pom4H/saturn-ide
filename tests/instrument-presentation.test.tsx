import {expect,test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {device,project,signal,terminal,type Snapshot} from '../src/core';
import {Symbol} from '../src/shell/symbols';
import {instrumentReading} from '../src/shell/instrument-style';
import {instrumentMount} from '../src/shell/instrument-mount';

const gauge=device({id:'pressure-gauge',icon:'sensor',ports:{},signals:{value:signal({initial:0,unit:'bar',min:0,max:16})},capabilities:{diagram:{width:100,height:110},instrument:{form:'dial',field:'value',precision:1,min:0,max:16}}});
const display=device({id:'temperature-display',icon:'sensor',ports:{},signals:{value:signal({initial:20,unit:'°C'})},capabilities:{diagram:{width:100,height:110},instrument:{form:'digital',field:'value',precision:0}}});
const flowmeter=device({id:'flow-meter',icon:'sensor',ports:{inlet:terminal({x:0,y:55,z:46,side:'left',medium:'fluid',family:'water',role:'sink'}),outlet:terminal({x:120,y:55,z:46,side:'right',medium:'fluid',family:'water',role:'source'})},signals:{value:signal({initial:0,unit:'m³/h'})},capabilities:{diagram:{width:120,height:110},instrument:{form:'inline',field:'value',precision:1}}});

test('one authored instrument capability supplies matching 2D anatomy and measured readouts',()=>{
  const equipment=[gauge('PT-101',{label:'Pressure',x:50,y:50}),display('TT-101',{label:'Temperature',x:220,y:50}),flowmeter('FT-101',{label:'Flow',x:390,y:50})];
  const model=project({id:'instrument-sample',label:'Instruments',equipment,pipes:[]});
  expect(model.equipment.map(item=>item.capabilities.instrument?.form)).toEqual(['dial','digital','inline']);
  const now=Date.now(),snapshot:Snapshot={samples:Object.fromEntries(equipment.map((item,index)=>[`${item.id}.value`,{signal:`${item.id}.value`,value:[6.2,72,18.4][index]!,quality:'good',at:now}])),alarms:{}};
  expect(instrumentReading(equipment[0]!,snapshot,now)).toMatchObject({display:'6.2',unit:'bar',fraction:6.2/16});
  for(const [index,form] of ['dial','digital','inline'].entries()){
    const html=renderToStaticMarkup(<svg><Symbol equipment={equipment[index]!} snapshot={snapshot} locale="en"/></svg>);
    expect(html).toContain(`data-form="${form}"`);
    expect(html).toContain('data-reading="good"');
    expect(html).toContain(index===0?'6.2':index===1?'72':'18.4');
  }
  const stale:Snapshot={samples:{...snapshot.samples,'PT-101.value':{signal:'PT-101.value',value:6.2,quality:'stale',at:now}},alarms:{}};
  expect(instrumentReading(equipment[0]!,stale,now)?.display).toBe('—');
  expect(renderToStaticMarkup(<Symbol equipment={equipment[0]!} snapshot={stale} locale="en"/>)).toContain('data-reading="stale"');
});

test('instrument contract rejects an absent numeric field, inverted scale and false inline spool',()=>{
  const invalidField=device({id:'bad-field',icon:'sensor',ports:{},capabilities:{diagram:{width:100,height:110},instrument:{form:'dial',field:'value'}}});
  expect(()=>project({id:'bad-field-project',label:'Bad',equipment:[invalidField('X',{label:'X',x:0,y:0})],pipes:[]})).toThrow(/Invalid instrument/);
  const inverted=device({id:'bad-range',icon:'sensor',ports:{},signals:{value:signal({initial:0})},capabilities:{diagram:{width:100,height:110},instrument:{form:'dial',field:'value',min:10,max:1}}});
  expect(()=>project({id:'bad-range-project',label:'Bad',equipment:[inverted('X',{label:'X',x:0,y:0})],pipes:[]})).toThrow(/Invalid instrument/);
  const unmounted=device({id:'unmounted',icon:'sensor',ports:{},signals:{value:signal({initial:0})},capabilities:{diagram:{width:100,height:110},instrument:{form:'dial',field:'value',mount:{pipe:'missing'}}}});
  expect(()=>project({id:'bad-mount-project',label:'Bad',equipment:[unmounted('X',{label:'X',x:0,y:0})],pipes:[]})).toThrow(/Invalid pipe mount/);
  const falseSpool=device({id:'false-spool',icon:'sensor',ports:{},signals:{value:signal({initial:0})},capabilities:{diagram:{width:120,height:110},instrument:{form:'inline',field:'value'}}});
  expect(()=>project({id:'false-spool-project',label:'Bad',equipment:[falseSpool('X',{label:'X',x:0,y:0})],pipes:[]})).toThrow(/Invalid instrument/);
});

test('an authored pipe tap projects onto the current route and follows its drag position',()=>{
  const mounted=device({id:'mounted',icon:'sensor',ports:{},signals:{value:signal({initial:0})},capabilities:{diagram:{width:100,height:110},instrument:{form:'dial',field:'value',mount:{pipe:'water-main'}}}});
  const equipment=mounted('PT-02',{label:'Pressure',x:100,y:30});
  const route={id:'water-main',kind:'pipe' as const,valid:true,points:[{x:0,y:200,z:40},{x:300,y:200,z:40}]};
  expect(instrumentMount(equipment,[route])).toEqual({from:{x:150,y:140,z:0},to:{x:150,y:200,z:40}});
  expect(instrumentMount({...equipment,x:160},[route])?.to.x).toBe(210);
  expect(instrumentMount(equipment,[{...route,valid:false}])).toBeNull();
});

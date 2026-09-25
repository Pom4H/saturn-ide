import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { command, project, pump, signal, type Project, type Signal, type Value } from '../src/core';
import { defineProtocol, prepareAcquisition, type AcquisitionContext, type Observation, type Observe, type ProtocolSession } from '../src/core/acquisition';
import { acquire } from '../src/runtime/acquisition';
import { jsonHttp } from '@saturn/protocols/json-http';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function eventually(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() > end) throw new Error('Condition was not reached'); await sleep(2); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return {promise,resolve};
}
function model(...signals: Signal[]): Project {
  return project({id:'plant',label:'Plant',equipment:[],pipes:[],alarms:[],signals:Object.fromEntries(signals.map(s => [s.id,s]))});
}
function context(project: Project, observe: Observe): AcquisitionContext {
  return {project,snapshot:{samples:{},alarms:{}},publish:async () => { throw new Error('Must not downgrade to values'); },observe};
}
function protocol(connect: (config: string, abort: AbortSignal) => Promise<ProtocolSession<string>>) {
  return defineProtocol({id:'test',address(input: unknown) { if (typeof input !== 'string') throw new Error('String address required'); return input; },connect});
}
const options = {pollMs:5,timeoutMs:500,reconnectMs:5,maxReconnectMs:20};

test('definition/binding/plan have no I/O; owned IDs and value types survive', () => {
  let connections = 0;
  const factory = protocol(async () => { connections++; return {read:async () => [],close(){}}; });
  const source = factory('plc','unused',options);
  const rpm = source.bind(signal({initial:0,unit:'rpm'}),'speed');
  const item = pump('P-01',{x:0,y:0,label:'Pump',rpm});
  const p = project({id:'plant',label:'Plant',equipment:[item],pipes:[],alarms:[]});
  assert.equal(item.rpm.id,'P-01.rpm');
  assert.equal(item.rpm.binding?.protocol,'test');
  assert.equal(prepareAcquisition(JSON.parse(JSON.stringify(p)) as Project,[source])[0]!.plan.signals[0]!.id,'P-01.rpm');
  assert.equal(connections,0);
  assert.throws(() => source.bind(item.rpm,'another'),/already/);
  function checkTypes() {
    const target = source.bind(signal('command',{initial:false,writable:true}),'run');
    command(target,true);
    // @ts-expect-error A boolean command cannot accept a number.
    command(target,1);
    // @ts-expect-error Protocol addresses are strings, not arbitrary objects.
    source.bind(signal({initial:0}),{register:10});
    // @ts-expect-error Binding must not turn read-only measurements into writable signals.
    command(item.rpm,100);
  }
  void checkTypes;
});

test('duplicate/missing owners fail before opening connections', async () => {
  let opened = 0;
  const source = protocol(async () => { opened++; return {read:async()=>[],close(){}}; })('plc','',options);
  const p = model(source.bind(signal('a',{initial:0}),'A'));
  await assert.rejects(acquire(source,source).start(context(p,async()=>{})),/Duplicate/);
  await assert.rejects(acquire().start(context(p,async()=>{})),/Missing source/);
  const malformed = JSON.parse(JSON.stringify(p)) as Project;
  const s = Object.values(malformed.signals)[0]!;
  malformed.signals[s.id] = {...s,binding:{...s.binding!,address:'42'}};
  await assert.rejects(acquire(source).start(context(malformed,async()=>{})),/String address/);
  assert.equal(opened,0);
});

test('a legacy host is rejected rather than silently discarding quality', async () => {
  const driver = acquire();
  await assert.rejects(driver.start({project:model(),snapshot:{samples:{},alarms:{}},publish:async()=>{}}),/observation-aware/);
});

test('one batch per connection; polls never overlap', async t => {
  let active = 0, maximum = 0, reads = 0;
  const received: Observation[][] = [];
  const source = protocol(async () => ({
    async read(channels) {
      active++; maximum = Math.max(maximum,active); await sleep(8); active--; reads++;
      assert.equal(channels.length,2);
      return channels.map(channel => ({signal:channel.signal.id,value:12,quality:'good',sourceAt:100,sequence:reads}));
    },close(){},
  }))('plc','',options);
  const p = model(source.bind(signal('a',{initial:0}),'A'),source.bind(signal('b',{initial:0}),'B'));
  const driver = acquire(source), stop = await driver.start(context(p,async batch=>{received.push([...batch]);}));
  t.after(stop); await eventually(()=>received.length>=3);
  assert.equal(maximum,1); assert.equal(received[0]![0]!.sourceAt,100);
  assert.equal(driver.status()[0]!.receivedBatches,received.length);
});

test('a failing source does not stop other sources; close precedes reconnect', async t => {
  const order: string[] = [], received: Observation[] = [];
  let attempt = 0;
  const bad = protocol(async () => {
    const n = ++attempt; order.push(`open${n}`);
    return {async read(){throw new Error('wire down');},close(){order.push(`close${n}`);}};
  })('bad','',options);
  const good = protocol(async () => ({read:async channels=>channels.map(c=>({signal:c.signal.id,value:7,quality:'good'})),close(){}}))('good','',options);
  const p = model(bad.bind(signal('bad.value',{initial:0}),'x'),good.bind(signal('good.value',{initial:0}),'y'));
  const driver = acquire(bad,good), stop = await driver.start(context(p,async batch=>{received.push(...batch);}));
  t.after(stop); await eventually(()=>attempt>=2 && received.some(x=>x.signal==='good.value'&&x.quality==='good'));
  assert.ok(order.indexOf('close1')<order.indexOf('open2'));
  assert.ok(received.some(x=>x.signal==='bad.value'&&x.quality==='offline'&&!('value'in x)));
});

test('subscription uses the same observations; keepalive is not a sample', async t => {
  let emit!: Observe;
  const hold = deferred<void>(), received: Observation[] = [];
  const source = protocol(async()=>({async subscribe(_channels,publish){emit=publish;await hold.promise;},close(){hold.resolve();}}))('plc','',options);
  const driver=acquire(source), stop=await driver.start(context(model(source.bind(signal('a',{initial:0}),'A')),async batch=>{received.push(...batch);}));
  t.after(stop); await eventually(()=>!!emit);
  await emit([]); assert.equal(driver.status()[0]!.receivedBatches,0);
  await emit([{signal:'a',value:1,quality:'bad',sourceAt:123,sequence:4}]);
  assert.equal(received[0]!.quality,'bad'); assert.equal(received[0]!.sequence,4);
  await stop(); await emit([{signal:'a',value:99,quality:'good'}]);
  assert.equal(received.length,1);
});

test('subscription applies backpressure and rejects foreign/duplicate signals atomically', async t => {
  let emit!: Observe;
  const hold=deferred<void>(), persistence=deferred<void>(); let accepted=0;
  const source=protocol(async()=>({async subscribe(_c,publish){emit=publish;await hold.promise;},close(){hold.resolve();}}))('plc','',options);
  const driver=acquire(source),stop=await driver.start(context(model(source.bind(signal('a',{initial:0}),'A')),async()=>{accepted++;await persistence.promise;}));
  t.after(stop);await eventually(()=>!!emit);
  await assert.rejects(emit([{signal:'foreign',value:1,quality:'good'}]),/foreign/);
  await assert.rejects(emit([{signal:'a',value:1,quality:'good'},{signal:'a',value:2,quality:'good'}]),/batch/);
  const pending=emit([{signal:'a',value:1,quality:'good'}]);
  await assert.rejects(emit([{signal:'a',value:2,quality:'good'}]),/previous emit/);
  persistence.resolve();await pending;assert.equal(accepted,1);
});

test('commands share the bounded poll queue and do not manufacture observations', async t => {
  const write=deferred<void>(), values:Value[]=[],observations:Observation[]=[];
  const source=protocol(async()=>({read:async()=>[],async write(_channel,value){values.push(value);await write.promise;},close(){write.resolve();}}))('plc','',{...options,maxPendingWrites:1});
  const s=source.bind(signal('run',{initial:false,writable:true}),'run');
  const driver=acquire(source),stop=await driver.start(context(model(s),async batch=>{observations.push(...batch);}));
  t.after(stop);await eventually(()=>driver.status()[0]?.phase==='online');
  const first=driver.write!('run',true);await eventually(()=>values.length===1);
  await assert.rejects(driver.write!('run',false),/queue is full/);
  write.resolve();await first;assert.equal(observations.length,0);assert.deepEqual(values,[true]);
  await assert.rejects(driver.write!('run',12),/Invalid value/);
});

test('write error is not automatically retried after reconnection', async t => {
  let writes=0;
  const source=protocol(async()=>({read:async()=>[],async write(){writes++;throw new Error('answer lost');},close(){}}))('plc','',options);
  const driver=acquire(source),stop=await driver.start(context(model(source.bind(signal('run',{initial:false,writable:true}),'run')),async()=>{}));
  t.after(stop);await eventually(()=>driver.status()[0]?.phase==='online');
  await assert.rejects(driver.write!('run',true),/answer lost/);
  await eventually(()=>driver.status()[0]!.attempts>=2);assert.equal(writes,1);
});

test('stop fences a non-cooperative late read and allows a clean restart', async () => {
  const late=deferred<readonly Observation[]>(),received:Observation[]=[];let opened=0,closed=0;
  const source=protocol(async()=>{const n=++opened;return {read:async()=>n===1?late.promise:[],close(){closed++;}};})('plc','',options);
  const driver=acquire(source),ctx=context(model(source.bind(signal('a',{initial:0}),'A')),async batch=>{received.push(...batch);});
  const stop=await driver.start(ctx);await eventually(()=>driver.status()[0]?.phase==='online');
  await sleep(2);await stop();
  const stop2=await driver.start(ctx);await eventually(()=>opened===2);
  late.resolve([{signal:'a',value:999,quality:'good'}]);await sleep(5);await stop2();
  assert.equal(received.length,0);assert.equal(closed,2);
});

test('failed cleanup prevents a second session and fails stop closed', async () => {
  let opened=0;
  const source=protocol(async()=>{opened++;return {async read(){throw new Error('lost');},close(){throw new Error('cannot release');}};})('plc','',options);
  const driver=acquire(source),ctx=context(model(source.bind(signal('a',{initial:0}),'A')),async()=>{});
  const stop=await driver.start(ctx);await eventually(()=>driver.status()[0]?.phase==='faulted');
  await sleep(15);assert.equal(opened,1);await assert.rejects(stop(),/did not stop cleanly/);
  await assert.rejects(driver.start(ctx),/already started/);
});

test('late successful connect is closed after cancellation, never activated', async () => {
  const ready=deferred<ProtocolSession<string>>();let opened=0,closed=0,reads=0;
  const source=protocol(async()=>{opened++;return ready.promise;})('plc','',options);
  const driver=acquire(source),stop=await driver.start(context(model(source.bind(signal('a',{initial:0}),'A')),async()=>{}));
  await eventually(()=>opened===1);const stopping=stop();
  ready.resolve({read:async()=>{reads++;return [];},close(){closed++;}});
  await stopping;assert.equal(closed,1);assert.equal(reads,0);
});

test('observation validation rejects invalid values but accepts measured range excursions', async t => {
  const received: Observation[]=[];
  const source=protocol(async()=>({read:async()=>[{signal:'temperature',value:105,quality:'good'}],close(){}}))('plc','',options);
  const s=source.bind(signal('temperature',{initial:20,min:0,max:100,writable:true}),'temperature');
  const driver=acquire(source),stop=await driver.start(context(model(s),async batch=>{received.push(...batch);}));
  t.after(stop);await eventually(()=>received.length>0);assert.equal(received[0]!.value,105);
  await assert.rejects(driver.write!('temperature',105),/Cannot write/); // adapter is read-only
});

test('JSON/HTTP plugin makes real loopback requests and preserves metadata', async t => {
  let posts=0;const commands: unknown[]=[];
  const server=createServer((request,response)=>{
    if(request.method==='POST'){
      let body='';request.on('data',chunk=>{body+=String(chunk);});request.on('end',()=>{commands.push(JSON.parse(body));posts++;response.writeHead(202);response.end();});
    }else{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({speed:{value:1400,quality:'good',sourceAt:1234,sequence:7},run:{value:false,quality:'good'}}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();}));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const source=jsonHttp('bench',{url:`http://127.0.0.1:${address.port}/io`},{...options,mode:'simulation'});
  const received:Observation[]=[];
  const driver=acquire(source),stop=await driver.start(context(model(source.bind(signal('rpm',{initial:0}),{tag:'speed'}),source.bind(signal('run',{initial:false,writable:true}),{tag:'run'})),async batch=>{received.push(...batch);}));
  t.after(stop);await eventually(()=>received.some(item=>item.signal==='rpm'));
  assert.equal(received.find(item=>item.signal==='rpm')!.sourceAt,1234);
  await driver.write!('run',true);assert.equal(posts,1);assert.deepEqual(commands,[{tag:'run',value:true}]);
  assert.ok(received.filter(item=>item.signal==='run').every(item=>item.value===false));
});

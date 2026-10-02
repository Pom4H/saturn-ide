import {test,expect} from 'bun:test';
import {applyDslProposal,dslCatalog} from '../src/workspace/dsl-proposal';
const files={'equipment/P-01.device.ts':`import {signal,pump} from '@saturn/core'; export default pump('P-01',{semanticId:'equipment:pump',label:{ru:'Насос',en:'Pump'},run:signal({initial:true,writable:true}),rpm:signal({initial:0,unit:'rpm'})});`,'project.ts':`import {alarm} from '@saturn/core'; const rule=alarm('pressure',{above:4.5});`};
test('plain authored labels need neither locale nor an explicit semantic ID',()=>{
 const path='equipment/PT-01.device.ts',source=`import {signal} from '@saturn/core'; import {sensor} from './sensor'; export default sensor('PT-01',{label:'Давление',x:10,y:20,value:signal({initial:0,unit:'bar'})});`;
 const targets=dslCatalog({[path]:source});
 expect(targets).toEqual([{kind:'equipment.label',id:'PT-01',path,value:'Давление'},{kind:'signal.initial',id:'PT-01.value',path,value:0}]);
 const value='Давление "после насоса"\nПроверить';
 expect(applyDslProposal({[path]:source},[{kind:'equipment.label',id:'PT-01',value}])[path]).toBe(source.replace("'Давление'",JSON.stringify(value)));
 expect(()=>applyDslProposal({[path]:source},[{kind:'equipment.label',id:'PT-01',locale:'ru',value}])).toThrow('Unknown or ambiguous');
 for(const label of ['computedLabel',"{...translations,ru:'Давление'}"]){
  const computed=source.replace("'Давление'",label);
  expect(dslCatalog({[path]:computed}).some(target=>target.kind==='equipment.label')).toBe(false);
 }
 expect(()=>applyDslProposal(files,[{kind:'equipment.label',id:'P-01',value:'Насос'}])).toThrow('Unknown or ambiguous');
});
test('DSL proposals preserve source and encode text as a literal',()=>{
 expect(dslCatalog(files)).toHaveLength(5);
 const changed=applyDslProposal(files,[{kind:'equipment.label',id:'P-01',locale:'ru',value:"'); fetch('/admin'); ('"},{kind:'signal.initial',id:'P-01.run',value:false}]);
 expect(changed['equipment/P-01.device.ts']).toContain(JSON.stringify("'); fetch('/admin'); ('"));
 expect(changed['equipment/P-01.device.ts']).toContain('initial:false');expect(changed['project.ts']).toBeUndefined();
});
test('unknown, duplicate, computed, vendor-internal and incompatible edits fail closed',()=>{
 expect(()=>applyDslProposal(files,[{kind:'signal.initial',id:'P-01.run',value:12}])).toThrow();
 expect(()=>applyDslProposal(files,[{kind:'alarm.above',id:'unknown',value:10}])).toThrow();
 expect(()=>applyDslProposal(files,[{kind:'alarm.above',id:'pressure',value:4},{kind:'alarm.above',id:'pressure',value:6}])).toThrow();
 expect(dslCatalog({'plugins/x/equipment/P-01.device.ts':files['equipment/P-01.device.ts']})).toEqual([]);
 expect(dslCatalog({'equipment/P-01.device.ts':files['equipment/P-01.device.ts'].replace('initial:0','initial:Math.random()')})).toHaveLength(3);
 expect(()=>applyDslProposal({...files,'equipment/duplicate.device.ts':files['equipment/P-01.device.ts']},[{kind:'signal.initial',id:'P-01.run',value:false}])).toThrow();
});

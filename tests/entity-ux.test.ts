import {expect,test} from 'bun:test';
import {placementAt,nextEntityId,templateDimensions,previewEquipment,positionNearEquipment} from '../src/shell/model/entity-placement';
import {tank,pump} from '../src/core';
import {patchDeviceProperties} from '../src/workspace/device-properties';

test('click placement snaps and avoids equipment footprints',()=>{
 expect(placementAt({x:153,y:175},'pump',[])).toEqual({x:40,y:100,valid:true});
 expect(placementAt({x:153,y:175},'pump',[{x:90,y:90,width:160,height:150}]).valid).toBe(false);
 expect(placementAt({x:600,y:300},'pump',[{x:90,y:90,width:160,height:150}]).valid).toBe(true);
 expect(templateDimensions('pump')).toEqual({width:220,height:170});
 expect(templateDimensions('tank')).toEqual({width:170,height:230});
 expect(previewEquipment('pump','Насос')?.kind).toBe('pump');
 expect(nextEntityId('pump',['P-01','P-03'])).toBe('P-02');
 expect(nextEntityId('plc',['PLC-01'])).toBe('PLC-02');
});
test('property inspector edits only authored literals, preserving ports/signals and semantically stable id',()=>{
 const original=`import { pump, signal } from '@saturn/core';\nconst motor=pump('P-01',{\n  semanticId:'machine/01',label:'Старый насос', x:100,y:200,\n  rpm:signal({initial:0}),run:signal({initial:false,writable:true})\n});\n`;
 const output=patchDeviceProperties(original,'P-01',{label:'Насос №1',x:340,y:280,z:90,system:'room-a'});
 expect(output).toContain('label:"Насос №1", x:340,y:280,');
 expect(output).toContain('z: 90');expect(output).toContain('system: "room-a"');
 expect(output).toContain("semanticId:'machine/01'");expect(output).toContain('rpm:signal({initial:0})');
 const detached=patchDeviceProperties(output,'P-01',{system:null});expect(detached).toContain('system: undefined');
});
test('localization and computed positions remain safe',()=>{
 const src=`const a=pump('P-01',{label:{ru:'Старое',en:'Old'},x:100,y:200});`;
 const next=patchDeviceProperties(src,'P-01',{label:'Новое',locale:'ru'});
 expect(next).toContain(`ru:"Новое",en:'Old'`);
 expect(()=>patchDeviceProperties(`const a=pump('P-01',{label:'a',x:baseX,y:3});`,'P-01',{x:100})).toThrow('Computed x');
 expect(()=>patchDeviceProperties(src+'\n'+src,'P-01',{x:1})).toThrow('ambiguous');
 expect(()=>patchDeviceProperties(src,'P-01',{z:Infinity})).toThrow('Invalid z');
});

test('the ChatGPT reference placement uses the same footprints as the visual palette',()=>{
  const reservoir=tank('TK-01',{label:'Reservoir',x:100,y:80});
  const right=positionNearEquipment('pump','TK-01',[reservoir],'right');
  expect(right).toEqual({x:300,y:120});
  const motor=pump('P-01',{label:'Pump',...right});
  expect(()=>positionNearEquipment('pump','missing',[reservoir])).toThrow('Unknown reference');
  expect(()=>positionNearEquipment('pump','TK-01',[reservoir,motor],'right')).toThrow('No collision-free');
  const alternative=positionNearEquipment('pump','TK-01',[reservoir,motor]);
  expect(alternative).not.toEqual(right);
  expect(placementAt({x:alternative.x+110,y:alternative.y+85},'pump',[
    {x:reservoir.x,y:reservoir.y,width:170,height:230},
    {x:motor.x,y:motor.y,width:220,height:170},
  ]).valid).toBe(true);
});

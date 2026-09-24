import { expect, test } from 'bun:test';
import demo from '../project/project';
import { previewEquipmentRename } from '../src/workspace/refactor';
import type { ProjectResource } from '../src/core/resources';

test('equipment rename edits one AST literal and previews semantic blast radius',()=>{
  const source=`const note = "P-01";\nexport default arbitraryFactory('P-01', { label:'Pump', x:0, y:0, rpm });\n`;
  const start=source.indexOf("arbitraryFactory('P-01'");
  const resource:ProjectResource={
    uri:'saturn://pumping-station/device/equipment%3Abooster-primary',kind:'device',
    name:{en:'Booster pump',ru:'Повысительный насос'},icon:'pump',entityId:'P-01',semanticId:'equipment:booster-primary',
    source:{path:'equipment/P-01.device.ts',from:start,to:source.length},editors:['source','diagram'],related:[],
  };
  const preview=previewEquipmentRename(demo,resource,source,'P-201');
  expect(preview.source).toContain('const note = "P-01"');
  expect(preview.source).toContain('arbitraryFactory("P-201"');
  expect(preview.semanticId).toBe('equipment:booster-primary');
  expect(preview.affected.some(item=>item.kind==='connection')).toBe(true);
});
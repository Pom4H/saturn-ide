import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceTree } from '../src/shell/model/resource-tree';
import type { ProjectResource } from '../src/core/resources';
test('explorer follows real nested paths, retains multi-entity files and never invents a source',()=>{
  const file=(uri:string,path:string,kind:ProjectResource['kind']='file'):ProjectResource=>({uri,source:{path},kind,name:{en:uri,ru:uri},icon:kind,editors:['source'],related:[]});
  const first=file('P-01','systems/water/devices.ts','device'),second=file('V-01','systems/water/devices.ts','device');
  const absent={...file('missing','invented.ts','device'),source:undefined};
  const tree=resourceTree({project:'root',revision:'r',resources:[first,second,file('source','systems/water/devices.ts'),file('project','project.ts','project'),file('helper','plugins/vendor/hmi/frame.ts'),absent]});
  assert.deepEqual(tree.map(node=>node.name),['plugins','systems','project.ts']);
  const shared=tree[1]!.children[0]!.children[0]!;
  assert.equal(shared.path,'systems/water/devices.ts');assert.equal(shared.resource?.uri,'source');
  assert.deepEqual(shared.children.map(node=>node.resource?.uri),['P-01','V-01']);
  assert.ok(!JSON.stringify(tree).includes('invented.ts'));
  assert.equal(tree[0]!.children[0]!.children[0]!.children[0]!.path,'plugins/vendor/hmi/frame.ts');
});

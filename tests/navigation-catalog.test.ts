import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorNames, supportsEditor, availableEditors, type EditorId } from '../src/core/resources';
import { navigationCatalog, navigationViews, sectionFor, quickViews, toolCommands, findNavigationViews, visibleView } from '../src/shell/model/navigation-catalog';

test('every surface has one navigation contribution and launcher/sidebar targets resolve',()=>{
  assert.deepEqual(Object.keys(navigationCatalog).sort(),Object.keys(editorNames).sort());
  const editors=toolCommands.flatMap(command=>command.kind==='view'?[command.editor]:[]);
  assert.equal(new Set(editors).size,editors.length);
  for(const id of Object.keys(editorNames) as EditorId[])for(const host of ['browser','terminal'] as const){
    assert.equal(visibleView(id,{host,operator:false}),supportsEditor(id,host));
    const resource={uri:'test',kind:'project' as const,name:{ru:'тест',en:'test'},icon:'project',editors:[id],source:{path:'project.ts'},related:[]};
    assert.equal(availableEditors(resource,host).includes(id),supportsEditor(id,host));
  }
});
test('all discovery placements use the same authoring visibility policy',()=>{
  for(const preset of ['home','business'] as const)for(const placement of ['search','mobile','project'] as const){
    const ids=navigationViews({host:'browser',operator:true,preset},placement);
    for(const id of ids)assert.ok(!navigationCatalog[id].authoring,id);
    for(const id of ['source','git','dependencies','trash'] as const)assert.ok(!ids.includes(id));
  }
  assert.deepEqual(navigationViews({host:'browser',operator:false,preset:'home'},'mobile').slice(0,3),['hmi','performance','reports']);
  assert.deepEqual(navigationViews({host:'browser',operator:false},'project'),['diagram','signals','reports','hmi','docs','dependencies']);
});
test('search accepts contextual names while returning one canonical Code page',()=>{
  const context={host:'browser' as const,operator:false};
  assert.deepEqual(findNavigationViews(context,'код','ru'),['source']);
  assert.deepEqual(findNavigationViews(context,'show in code','en'),['source']);
  assert.deepEqual(findNavigationViews({...context,operator:true},'TypeScript','en'),[]);
  assert.equal(quickViews('home')[0].editor,'hmi');assert.equal(quickViews('business')[1].editor,'source');
});

test('all primary capabilities remain discoverable without a second sidebar menu',()=>{
  for(const preset of ['home','business'] as const)for(const operator of [false,true])assert.ok(navigationViews({host:'browser',operator,preset},'mobile').includes('hmi'));
  for(const id of ['diagram','hmi','performance','reports','source','git','targets'] as const){assert.ok(navigationViews({host:'browser',operator:false}).includes(id));assert.ok(navigationCatalog[id].title.ru);assert.equal(sectionFor(id),navigationCatalog[id].section);}
});

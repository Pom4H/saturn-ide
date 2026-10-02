import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBrowserView, browserViewSearch } from '../src/shell/model/browser-view';
import { detailsVisible, layoutFromView, layoutReducer, layoutViewFields, type LayoutAction } from '../src/shell/model/layout';

test('Shell page and slot transitions close obsolete chrome atomically',()=>{
  let layout=layoutFromView(readBrowserView('?page=chat&pane=1&full=1&details=review'));
  layout=layoutReducer(layout,{type:'summary',open:true});
  for(const page of ['home','settings','threads'] as const){
    const next=layoutReducer(layout,{type:'navigate',page});
    assert.equal(next.page,page);assert.equal(next.details,'none');assert.equal(next.summary,false);
    assert.deepEqual(next.artifact,{visibility:'closed',content:'tool'});
  }
});
test('launcher and closed chat pane retain the session view while normalizing fullscreen',()=>{
  let layout=layoutFromView(readBrowserView('?page=chat&pane=1&full=1&details=catalog'));
  layout=layoutReducer(layout,{type:'new-tab'});assert.equal(layout.page,'threads');assert.equal(layout.details,'none');assert.equal(detailsVisible(layout),false);
  layout=layoutReducer(layout,{type:'close-pane'});assert.equal(layout.artifact.visibility,'closed');assert.equal(layoutViewFields(layout).full,false);
  layout=layoutReducer(layout,{type:'show-pane'});assert.equal(layout.artifact.content,'launcher');
  layout=layoutReducer(layout,{type:'close-new-tab'});assert.equal(layout.artifact.content,'tool');
  layout=layoutReducer(layout,{type:'open-tool',page:'resources'});assert.equal(layout.page,'resources');
});
test('one details slot replaces another and never appears inside settings or a hidden chat tool',()=>{
  let layout=layoutFromView(readBrowserView('?page=source'));
  for(const slot of ['properties','review','catalog'] as const){layout=layoutReducer(layout,{type:'details',slot});assert.equal(layout.details,slot);assert.equal(detailsVisible(layout),true);}
  layout=layoutReducer(layout,{type:'toggle-details',slot:'catalog'});assert.equal(layout.details,'none');
  layout=layoutReducer(layout,{type:'navigate',page:'settings'});layout=layoutReducer(layout,{type:'details',slot:'review'});assert.equal(layout.details,'none');
  layout=layoutFromView(readBrowserView('?page=chat&details=properties'));assert.equal(detailsVisible(layout),false);
});
test('URL adapters round trip restored layout and reject a fullscreen closed pane',()=>{
  for(const search of ['?page=source&details=catalog','?page=chat&pane=1&newTab=1&full=1','?page=chat&pane=1&details=review']){
    const view=readBrowserView(search),layout=layoutFromView(view);
    assert.deepEqual(layoutFromView(readBrowserView(browserViewSearch({...view,...layoutViewFields(layout)}))),layout);
  }
  const layout=layoutFromView({...readBrowserView('?page=chat'),full:true,pane:false});assert.equal(layout.artifact.visibility,'closed');assert.equal(layoutViewFields(layout).full,false);
});
test('all layout actions preserve fullscreen and single-slot invariants across navigation sequences',()=>{
  const actions:LayoutAction[]=[{type:'navigate',page:'home'},{type:'navigate',page:'settings'},{type:'navigate',page:'threads'},{type:'open-tool'},{type:'open-tool',page:'resources'},{type:'new-tab'},{type:'close-new-tab'},{type:'show-pane'},{type:'close-pane'},{type:'toggle-full'},{type:'details',slot:'catalog'},{type:'toggle-details',slot:'review'},{type:'toggle-summary'}];
  const initial=layoutFromView(readBrowserView('?page=home'));
  for(const a of actions)for(const b of actions)for(const c of actions){const layout=[a,b,c].reduce(layoutReducer,initial);const fields=layoutViewFields(layout);assert.ok(!fields.full||fields.pane);assert.ok(layout.page!=='settings'||layout.details==='none');assert.ok(layout.page!=='resources'||layout.artifact.visibility==='central');assert.ok(!detailsVisible(layout)||layout.details!=='none');}
});


test('resource destinations always own the center; chat pane shortcuts cannot hide their view',()=>{
  let layout=layoutFromView(readBrowserView('?page=source'));
  for(const action of [{type:'close-pane'},{type:'toggle-full'},{type:'show-pane'},{type:'new-tab'},{type:'close-new-tab'}] as const){layout=layoutReducer(layout,action);assert.equal(layout.page,'resources');assert.equal(layout.artifact.visibility,'central');assert.equal(layoutViewFields(layout).pane,false);}
});

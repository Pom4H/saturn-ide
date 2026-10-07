import { expect, test } from 'bun:test';
import { browserViewSearch, readBrowserView } from '../src/shell/model/browser-view';

test('view links preserve resource identity, selected view, camera and shell panels',()=>{
  const view=readBrowserView('?page=source&file=equipment%2FP-01.device.ts&device=P-01&dimension=3d&camera=1,2,3,0,0,0&viewBox=10,20,850,460&panel=terminal&panelOpen=1&details=review');
  expect(readBrowserView(browserViewSearch(view))).toEqual(view);
  expect(view.file).toBe('equipment/P-01.device.ts');expect(view.camera).toEqual([1,2,3,0,0,0]);
});
test('unknown routes and malformed camera values cannot become authored or runtime actions',()=>{
  expect(readBrowserView('?page=apply&panel=flash&camera=1,2,NaN,0,0,0&viewBox=0,0,-1,20')).toMatchObject({page:'home',tool:'diagram',panel:'equipment',camera:undefined,viewBox:undefined});
  expect(readBrowserView('?camera=Infinity,1,1,0,0,0').camera).toBeUndefined();
});
test('Home opens 3D by default and explicitly preserves a 2D link; settings retain their section and underlying tool',()=>{
  expect(readBrowserView('')).toMatchObject({page:'home',dimension:'3d'});
  const home=readBrowserView('?page=home&dimension=2d');expect(readBrowserView(browserViewSearch(home))).toEqual(home);
  const settings=readBrowserView('?page=settings&settings=appearance&tool=source&file=project.ts');expect(readBrowserView(browserViewSearch(settings))).toEqual(settings);
  expect(readBrowserView('?page=settings&settings=flash').settings).toBe('general');
});
test('chat tool link and temporary new-tab state are distinct from resource destinations',()=>{
  const view=readBrowserView('?page=chat&tool=dependencies&newTab=1&pane=1');
  expect(view.page).toBe('chat');expect(view.tool).toBe('dependencies');expect(readBrowserView(browserViewSearch(view))).toEqual(view);
});

test('workspace library pages have stable URL destinations',()=>{
  for(const page of ['trash','equipment'] as const){const view=readBrowserView('?page='+page);expect(view.page).toBe(page);expect(view.tool).toBe(page);expect(readBrowserView(browserViewSearch(view))).toEqual(view);}
});

test('catalog can be linked alongside either TS or the same 3D project',()=>{
  for(const page of ['source','diagram'] as const){const view=readBrowserView(`?page=${page}&dimension=3d&details=catalog`);expect(view.details).toBe('catalog');expect(readBrowserView(browserViewSearch(view))).toEqual(view);}
});

test('a view link names the exact device port without authored or runtime mutation',()=>{const view=readBrowserView('?page=diagram&device=P-01&port=outlet&dimension=3d');expect(view.port).toBe('outlet');expect(readBrowserView(browserViewSearch(view))).toEqual(view);});

test('task links preserve the selected tool, signal and explicitly closed experiment context',()=>{
  for(const tool of ['diagram','source','scenarios'] as const){
    const view=readBrowserView(`?page=task&tool=${tool}&device=ADCT&signal=ADCT.voltage&details=none`);
    expect(view.page).toBe('task');expect(view.tool).toBe(tool);
    expect(browserViewSearch(view)).toContain('details=none');
    expect(readBrowserView(browserViewSearch(view))).toEqual(view);
  }
});

import {expect,test} from 'bun:test';
import {initialPanel,panelLayoutsReducer} from '../src/shell/model/panel';
import {releaseComparisonLabel} from '../src/shell/release-label';

test('environment layout changes preserve the working terminal layout',()=>{
  let state={work:{...initialPanel,tab:'terminal' as const,height:420},environment:{...initialPanel,open:false},scenarios:{...initialPanel,open:false}};
  const first=panelLayoutsReducer(state,{context:'environment',action:{type:'open',tab:'notifications'}});
  expect(first.work).toEqual(state.work);
  expect(first.environment).toMatchObject({open:true,tab:'notifications'});
  const next=panelLayoutsReducer(first,{context:'work',action:{type:'close'}});
  expect(next.environment).toEqual(first.environment);
  expect(next.work).toMatchObject({open:false,tab:'terminal',height:420});
});

test('release comparison never treats absent identities as matching builds',()=>{
  expect(releaseComparisonLabel({checked:null,applied:null,published:null},'en')).toBe('No checked build.');
  expect(releaseComparisonLabel({checked:'a',applied:null,published:null},'en')).toBe('The checked build has not been applied.');
  expect(releaseComparisonLabel({checked:'a',applied:'b',published:'a'},'en')).toBe('Checked and applied builds differ.');
  expect(releaseComparisonLabel({checked:'a',applied:'a',published:null},'en')).toContain('published version differs or is absent');
  expect(releaseComparisonLabel({checked:'a',applied:'a',published:'a'},'en')).toBe('Checked, published and applied builds match.');
});

import { test,expect } from 'bun:test';
import { panelReducer,initialPanel } from '../src/shell/model/panel';

test('assistant uses existing persistent panel with usable initial height',()=>{
 const state=panelReducer(initialPanel,{type:'open',tab:'assistant'});
 expect(state.height).toBe(420);
 expect(state.tab).toBe('assistant');
 expect(panelReducer(state,{type:'close'}).tab).toBe('assistant');
});

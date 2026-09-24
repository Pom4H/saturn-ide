import { test,expect } from 'bun:test';
import { zipSync,strToU8 } from 'fflate';
import { inspectUpload } from '../src/shell/assistant-upload';
import { panelReducer,initialPanel } from '../src/shell/model/panel';
test('legacy inventory decodes CP1251, keeps source/passwords local and rejects traversal',async()=>{
 const zip=zipSync({'LANMON.INI':strToU8('[NETWORK]\nPassword=do-not-send\n[MAP]\nMAP0=main.lm2\n'),'main.lm2':strToU8('legacy map'),'main.cpp':strToU8('dangerous()')});
 const result=await inspectUpload(new File([zip],'legacy.zip'));
 expect(result.files).toHaveLength(3);expect(result.files[0]!.references).toEqual(['main.lm2']);expect(JSON.stringify(result)).not.toContain('do-not-send');expect(JSON.stringify(result)).not.toContain('dangerous()');expect(result.warnings.some(w=>w.includes('Скрипты'))).toBe(true);
 await expect(inspectUpload(new File([zipSync({'../x.ini':strToU8('x')})],'bad.zip'))).rejects.toThrow('путь');
});
test('oversized archive entries and empty archives are rejected',async()=>{
 await expect(inspectUpload(new File([zipSync({'bomb.ini':new Uint8Array(9*1024*1024)})],'bomb.zip'))).rejects.toThrow('8 МБ');
 await expect(inspectUpload(new File([zipSync({})],'empty.zip'))).rejects.toThrow('не содержит');
});
test('assistant uses existing persistent panel with usable initial height',()=>{
 const state=panelReducer(initialPanel,{type:'open',tab:'assistant'});expect(state.height).toBe(420);expect(state.tab).toBe('assistant');expect(panelReducer(state,{type:'close'}).tab).toBe('assistant');
});

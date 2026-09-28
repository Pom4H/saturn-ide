import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrowserAgent } from '../src/host/browser-agent';

test('local ACP child prompts, asks permission and returns a turn',async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'saturn-acp-'));writeFileSync(join(cwd,'project.ts'),'export default {}');
  const agent=new BrowserAgent(cwd,['bun',resolve(import.meta.dir,'fixtures/fake-acp-agent.ts')]);
  try{
    await agent.start();expect(agent.snapshot().phase).toBe('ready');
    agent.prompt('Inspect the project');
    for(let i=0;i<100&&!agent.snapshot().permission;i++)await Bun.sleep(10);
    const permission=agent.snapshot().permission;expect(permission?.title).toBe('Read project file');
    expect(()=>agent.permit(permission!.id,'unknown')).toThrow();
    agent.permit(permission!.id,'yes');
    for(let i=0;i<100&&agent.snapshot().phase==='busy';i++)await Bun.sleep(10);
    expect(agent.snapshot().phase).toBe('ready');
    expect(agent.snapshot().events.some(event=>event.kind==='text'&&event.text==='Approved')).toBe(true);
  }finally{agent.stop();rmSync(cwd,{recursive:true,force:true});}
},10000);

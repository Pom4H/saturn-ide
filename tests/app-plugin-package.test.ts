import {test,expect} from 'bun:test';
import {cpSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {publicHttps,validateAppPlugin} from '../scripts/validate-app-plugin';

const root=resolve(import.meta.dir,'../.agents/plugins/saturn');
test('local Saturn package passes subset checks and honestly fails public readiness',()=>{
  expect(validateAppPlugin(root).packageChecksPassed).toBe(true);
  const report=validateAppPlugin(root,'public');
  expect(report.packageChecksPassed).toBe(false);
  expect(report.blockers.some(item=>item.includes('public submission requires'))).toBe(true);
  expect(report.blockers.some(item=>item.includes('privacyPolicyURL'))).toBe(true);
  expect(report.unchecked).toContain('OpenAI review, approval and publication');
});
test('public preflight refuses registered local mappings and escaped assets',()=>{
  const copy=mkdtempSync(join(tmpdir(),'saturn-package-'));
  try{
    cpSync(root,copy,{recursive:true});
    writeFileSync(join(copy,'.app.json'),JSON.stringify({apps:{saturn:{id:'plugin_asdk_app_test',required:true}}}));
    const manifest=JSON.parse(readFileSync(join(copy,'plugin.json'),'utf8')) as {extensions:{'com.openai':{interface:{logo:string}}}};
    manifest.extensions['com.openai'].interface.logo='../outside.svg';writeFileSync(join(copy,'plugin.json'),JSON.stringify(manifest));
    const blockers=validateAppPlugin(copy,'public').blockers;
    expect(blockers.some(item=>item.includes('apps/.app.json'))).toBe(true);
    expect(blockers.some(item=>item.startsWith('logo:'))).toBe(true);
  }finally{rmSync(copy,{recursive:true,force:true});}
});
test('submission URLs reject local, reserved, credential-bearing and IP endpoints',()=>{
  for(const url of ['http://host.dev/mcp','https://127.0.0.1/mcp','https://[::1]/mcp','https://localhost/mcp','https://host.local/mcp','https://example.com/mcp','https://user:secret@service.dev/mcp','https://service.dev/mcp?key=secret'])expect(publicHttps(url)).toBe(false);
  expect(publicHttps('https://service.dev/mcp')).toBe(true);
});
test('passing package shape still reports all external submission gates as unchecked',()=>{
  const copy=mkdtempSync(join(tmpdir(),'saturn-public-package-'));
  try{
    cpSync(root,copy,{recursive:true});rmSync(join(copy,'.app.json'),{force:true});
    const manifest=JSON.parse(readFileSync(join(copy,'plugin.json'),'utf8')) as {extensions:{'com.openai':{apps?:string;interface:Record<string,unknown>;review:Record<string,unknown>}}};
    const openai=manifest.extensions['com.openai'];delete openai.apps;
    for(const field of ['websiteURL','supportURL','privacyPolicyURL','termsOfServiceURL'])openai.interface[field]='https://service.dev/'+field;
    openai.review.demo_recording_url='https://service.dev/walkthrough';
    writeFileSync(join(copy,'plugin.json'),JSON.stringify(manifest));
    writeFileSync(join(copy,'mcp.json'),JSON.stringify({mcpServers:{saturn:{type:'streamable-http',url:'https://service.dev/mcp'}}}));
    const report=validateAppPlugin(copy,'public');
    expect(report.packageChecksPassed).toBe(true);
    expect(report.unchecked).toContain('Verified publishing identity and portal permissions');
    expect(report.unchecked).toContain('OpenAI review, approval and publication');
  }finally{rmSync(copy,{recursive:true,force:true});}
});

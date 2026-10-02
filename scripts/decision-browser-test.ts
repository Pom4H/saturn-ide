import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/host/dev';
import { readDecisionRequest } from '../src/core/decision';
import { fixture, appRoot } from '../tests/helpers';
import { prepareInterface } from './helpers/interface-preferences';

const f=fixture(),out=join(appRoot,'artifacts','decision');mkdirSync(out,{recursive:true});
let broken=false,clarify=false,requests=0;
const payloads:string[]=[];
const model=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  assert.equal(new URL(request.url).pathname,'/v1/systemone');
  assert.equal(request.headers.get('authorization'),'Bearer test-provider-secret');
  const raw=await request.text();payloads.push(raw);requests++;
  if(broken)return Response.json({model:'broken',answers:{next:{type:'choice',choice:'invented'}}});
  const input=readDecisionRequest(JSON.parse(raw));
  const state=input.state as {request:string;resolved?:{command?:string;args?:string[]}};
  const args=state.resolved?.args??[];
  const label=!state.resolved?.command?'project open':clarify?'none':args.length===0?'P-01':'source';
  const criteria=input.questions.next.criteria;
  const choice=Object.entries(criteria).find(([,description])=>description.startsWith(label+':'))?.[0]??'none';
  return Response.json({model:'fixture-kev',answers:{next:{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(Object.keys(criteria).map(id=>[id,id===choice?1:0]))}},usage:{input_tokens:1,output_tokens:1}});
}});
const app=await createApp({projectDir:f.root,dataDir:f.dir,databaseUrl:':memory:',preview:'manual',port:0,decision:{SATURN_DECISION_PROVIDER:'custom',SATURN_DECISION_URL:new URL('/v1/systemone',model.url).href,SATURN_DECISION_MODEL:'fixture-kev',SATURN_DECISION_API_KEY:'test-provider-secret'}});
const browser=await chromium.launch({headless:true,channel:process.env.CI?'chrome':undefined,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
const confirm=page.getByRole('button',{name:'Подтвердить выполнение',exact:true});
async function visibleConfirmation(){
  assert(await confirm.evaluate(element=>{
    const rect=element.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
    const top=document.elementFromPoint(x,y);
    return x>=0&&y>=0&&x<window.innerWidth&&y<window.innerHeight&&!!top&&(top===element||element.contains(top));
  }),'confirmation must be visible and hit-testable, not clipped by the dock');
}
try{
  const config=await (await fetch(new URL('/api/decision',app.server.url))).text();assert(!config.includes('test-provider-secret'));
  const refused=await fetch(new URL('/api/decision/evaluate',app.server.url),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(refused.status,403);assert.equal(requests,0);
  await prepareInterface(page);
  await page.goto(app.server.url.toString());
  await page.getByRole('tab',{name:'Терминал',exact:true}).click();
  await page.getByRole('button',{name:'Текст',exact:true}).click();
  const prompt=page.getByRole('textbox',{name:'Запрос к IDE',exact:true}),prepare=page.getByRole('button',{name:'Подготовить',exact:true});
  await prompt.fill('Покажи насос P-01 в коде');await prepare.click();
  const proposal=page.getByLabel('Предлагаемая команда',{exact:true});
  await proposal.waitFor({timeout:15000});assert.equal(await proposal.innerText(),'/project open P-01 source');
  assert.equal(requests,3,'dependent command/resource/editor decisions must be sequential');
  await visibleConfirmation();await page.screenshot({path:join(out,'desktop-proposal.png')});
  await confirm.click();await page.locator('.decision-result').waitFor({timeout:15000});
  assert(await page.locator('.cm-editor').first().isVisible(),'command must open source in the browser session');
  assert.equal(await proposal.count(),0,'confirmed proposal is consumed');assert.equal(requests,3,'confirmation must not call the model again');
  await prepare.click();await proposal.waitFor();
  await prompt.fill('Не выполняй старую команду');assert.equal(await proposal.count(),0);
  broken=true;await prepare.click();await page.getByRole('alert').filter({hasText:'invalid choice'}).waitFor({timeout:15000});
  assert.equal(await confirm.count(),0);
  broken=false;clarify=true;
  await prompt.fill('Открой другое устройство');await prepare.click();
  const exact=page.getByRole('textbox',{name:'Точный ID или значение',exact:true});
  await exact.fill('not-a-real-device');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Точный ID или путь не найден'}).waitFor();
  assert.equal(await exact.getAttribute('aria-invalid'),'true');assert.equal(await confirm.count(),0);
  clarify=false;
  await page.setViewportSize({width:390,height:844});
  await prompt.fill('Покажи насос P-01 в коде');await prepare.click();await proposal.waitFor();
  await visibleConfirmation();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile page must not overflow horizontally');
  await page.screenshot({path:join(out,'mobile-proposal.png')});
  assert(!payloads.join('\n').includes('test-provider-secret'));assert(!payloads.join('\n').includes(app.state().key));
  assert(!payloads.join('\n').includes('import {'),'full authored source must not be in model context');
  assert.deepEqual(errors,[]);
  console.log('PASS: real browser text → System One API → proposal → existing source surface; no execution before confirm, visible desktop/mobile confirmation, consumed proposal, invalid response/argument rejection, host credentials and context privacy. Provider is a deterministic fixture, not a live Jev/Kev evaluation.');
}catch(error){await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});throw error;}
finally{await browser.close();await app.close();await model.stop(true);f.clean();}

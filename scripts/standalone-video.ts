import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base=Bun.env.SATURN_BASE??'http://127.0.0.1:4017',out=resolve(Bun.env.SATURN_VIDEO_DIR??'standalone-video'),raw=join(out,'raw');
mkdirSync(raw,{recursive:true});
const diagnostics:{console:string[];pageErrors:string[];requestFailed:string[];badResponses:string[];state?:unknown;releases?:unknown}={console:[],pageErrors:[],requestFailed:[],badResponses:[]};
const until=async(check:()=>Promise<boolean>,message:string)=>{for(let i=0;i<160;i++){if(await check().catch(()=>false))return;await Bun.sleep(250);}throw new Error(message);};
await until(async()=>(await fetch(base)).ok,'Standalone Saturn did not start');
diagnostics.state=await fetch(base+'/api/state').then(r=>r.json()).catch(error=>({error:String(error)}));
diagnostics.releases=await fetch(base+'/api/releases').then(r=>r.json()).catch(error=>({error:String(error)}));
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:raw,size:{width:1440,height:900}}});
const page=await context.newPage();
page.on('console',m=>diagnostics.console.push(`${m.type()}: ${m.text()}`));
page.on('pageerror',e=>diagnostics.pageErrors.push(e.message));
page.on('requestfailed',r=>diagnostics.requestFailed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText??'failed'}`));
page.on('response',r=>{if(r.status()>=400)diagnostics.badResponses.push(`${r.status()} ${r.url()}`);});
const pause=(ms=900)=>page.waitForTimeout(ms);
let failure:unknown;
try{
  await page.goto(base);await Bun.write(join(out,'page.html'),await page.content());
  await page.locator('[data-equipment="P-01"]').waitFor({timeout:30000});await pause(1800);
  const tree=page.getByRole('tree',{name:'Структура проекта'});
  await page.getByRole('button',{name:'Edit',exact:true}).click();await pause();
  const pump=page.locator('[data-equipment="P-01"]'),box=await pump.boundingBox();if(!box)throw new Error('P-01 is not visible');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2-24,{steps:18});await pause(450);await page.mouse.up();await pause(1200);
  await tree.getByRole('treeitem',{name:'P-01.device.ts',exact:true}).click();await page.locator('.cm-content').waitFor();await pause(1500);
  await tree.getByRole('treeitem',{name:'Сигналы',exact:true}).click();await pause(1200);
  const pressure=page.getByRole('button',{name:'P-01.pressure',exact:true});if(await pressure.count()){await pressure.click();await pause(1500);}
  await tree.getByRole('treeitem',{name:'HMI',exact:true}).click();await page.locator('.hmi-surface iframe').waitFor();await pause(1800);
  await tree.getByRole('treeitem',{name:'Отчёты',exact:true}).click();await pause();const generate=page.getByRole('button',{name:'Сформировать',exact:true});if(await generate.count()){await generate.click();await pause(1800);}
  await tree.getByRole('treeitem',{name:'Развёртывание',exact:true}).click();await pause(1800);
  await tree.getByRole('treeitem',{name:'Схема',exact:true}).click();await page.locator('[data-equipment="P-01"]').waitFor();await pause();
  await page.getByRole('button',{name:'3D',exact:true}).click();await until(async()=>Number(await page.locator('.scene3d').getAttribute('data-frames'))>3,'3D did not render');await pause(2200);
  await page.getByRole('button',{name:'2D',exact:true}).click();await pause(1200);
}catch(error){failure=error;await page.screenshot({path:join(out,'failure.png'),fullPage:false}).catch(()=>{});}
finally{await Bun.write(join(out,'browser-diagnostics.json'),JSON.stringify(diagnostics,null,2));await context.close();await browser.close();}
const webm=readdirSync(raw).find(name=>name.endsWith('.webm'));if(!webm)throw failure??new Error('Playwright did not produce a video');
const finalWebm=join(out,'saturn-windows-ux.webm');renameSync(join(raw,webm),finalWebm);
const mp4=join(out,'saturn-windows-ux.mp4'),ffmpeg=Bun.spawnSync(['ffmpeg','-y','-i',finalWebm,'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',mp4],{stdout:'ignore',stderr:'pipe'});
if(ffmpeg.exitCode!==0)console.warn('ffmpeg conversion skipped:',ffmpeg.stderr.toString());
if(failure)throw failure;
console.log(JSON.stringify({video:ffmpeg.exitCode===0?mp4:finalWebm,diagnostics}));

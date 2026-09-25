import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base=Bun.env.SATURN_BASE??'http://127.0.0.1:4017',out=resolve(Bun.env.SATURN_VIDEO_DIR??'standalone-video'),raw=join(out,'raw');
mkdirSync(raw,{recursive:true});
const until=async(check:()=>Promise<boolean>,message:string)=>{for(let i=0;i<160;i++){if(await check().catch(()=>false))return;await Bun.sleep(250);}throw new Error(message);};
await until(async()=>(await fetch(base)).ok,'Standalone Saturn did not start');
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:raw,size:{width:1440,height:900}}});
const page=await context.newPage();
const pause=(ms=900)=>page.waitForTimeout(ms);
try{
  await page.goto(base);await page.locator('[data-equipment="P-01"]').waitFor({timeout:30000});await pause(1800);
  const tree=page.getByRole('tree',{name:'Структура проекта'});
  await page.getByRole('button',{name:'Edit',exact:true}).click();await pause();
  const pump=page.locator('[data-equipment="P-01"]'),box=await pump.boundingBox();if(!box)throw new Error('P-01 is not visible');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2-24,{steps:18});await pause(450);await page.mouse.up();await pause(1200);
  await tree.getByRole('treeitem',{name:'P-01.device.ts',exact:true}).click();await page.locator('.cm-content').waitFor();await pause(1500);
  const line=page.locator('.cm-line').filter({hasText:'const booster = pump'});if(await line.count()){await line.hover();await pause(1200);}
  await tree.getByRole('treeitem',{name:'Сигналы',exact:true}).click();await pause(1200);
  const pressure=page.getByRole('button',{name:'P-01.pressure',exact:true});if(await pressure.count()){await pressure.click();await pause(1500);}
  await tree.getByRole('treeitem',{name:'HMI',exact:true}).click();await page.locator('.hmi-surface iframe').waitFor();await pause(1800);
  await tree.getByRole('treeitem',{name:'Отчёты',exact:true}).click();await pause();const generate=page.getByRole('button',{name:'Сформировать',exact:true});if(await generate.count()){await generate.click();await pause(1800);}
  await tree.getByRole('treeitem',{name:'Развёртывание',exact:true}).click();await pause(1800);
  await tree.getByRole('treeitem',{name:'Схема',exact:true}).click();await page.locator('[data-equipment="P-01"]').waitFor();await pause();
  await page.getByRole('button',{name:'3D',exact:true}).click();await until(async()=>Number(await page.locator('.scene3d').getAttribute('data-frames'))>3,'3D did not render');await pause(2200);
  await page.getByRole('button',{name:'2D',exact:true}).click();await pause(1200);
}finally{
  await context.close();await browser.close();
}
const webm=readdirSync(raw).find(name=>name.endsWith('.webm'));if(!webm)throw new Error('Playwright did not produce a video');
const webmPath=join(raw,webm),finalWebm=join(out,'saturn-windows-ux.webm');renameSync(webmPath,finalWebm);
const ffmpeg=Bun.spawnSync(['ffmpeg','-y','-i',finalWebm,'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',join(out,'saturn-windows-ux.mp4')],{stdout:'ignore',stderr:'pipe'});
if(ffmpeg.exitCode!==0)console.warn('ffmpeg conversion skipped:',ffmpeg.stderr.toString());

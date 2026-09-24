import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fixture } from '../tests/helpers';

const fixtureProject=fixture();
const base='http://127.0.0.1:4017';
mkdirSync('docs/screenshots',{recursive:true});

const server=Bun.spawn(['bun','dev'],{
  env:{...Bun.env,SATURN_PROJECT:fixtureProject.root,PORT:'4017',DATABASE_URL:':memory:',SATURN_PREVIEW:'simulation'},
  stdout:'pipe',stderr:'pipe'
});

const until=async(check:()=>Promise<boolean>,message:string)=>{
  for(let i=0;i<120;i++){if(await check().catch(()=>false))return;await Bun.sleep(250);}
  throw new Error(message);
};

let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
  await until(async()=>(await fetch(base)).ok,'bun dev did not start');
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1536,height:864},deviceScaleFactor:1});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await page.goto(base);
  await page.locator('[data-equipment="P-01"]').waitFor({timeout:30000});

  const nav=page.getByRole('navigation',{name:'Рабочие разделы'});
  const capture=async(label:string,file:string,ready?:()=>Promise<void>)=>{
    await nav.getByRole('button',{name:label,exact:true}).click();
    if(ready)await ready();
    await page.waitForTimeout(120);
    await page.screenshot({path:`docs/screenshots/${file}`,fullPage:false});
  };

  await page.screenshot({path:'docs/screenshots/diagram.png'});
  await capture('Исходник','source.png',async()=>{await page.locator('.cm-content').waitFor();});
  await capture('Сигналы','signals.png');
  await capture('Отчёты','reports.png');
  await capture('HMI','hmi.png',async()=>{await page.locator('.hmi-surface iframe').waitFor();});
  await capture('Среда','environment.png');
  await capture('Git','git.png');

  await nav.getByRole('button',{name:'Схема',exact:true}).click();
  await page.locator('[data-equipment="P-01"]').waitFor();
  await page.screenshot({path:'docs/screenshots/ide-dark.png'});

  await page.getByRole('button',{name:'3D',exact:true}).click();
  await until(async()=>Number(await page.locator('.scene3d').getAttribute('data-frames'))>2,'3D did not render');
  await page.screenshot({path:'docs/screenshots/ide-3d.png'});

  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.getByRole('button',{name:'Светлая тема',exact:true}).click();
  await page.waitForTimeout(100);
  await page.screenshot({path:'docs/screenshots/ide-light.png'});
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await server.exited;
  fixtureProject.clean();
}

import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProject } from '../src/workspace/project-template';

mkdirSync('.saturn',{recursive:true});
const temp=mkdtempSync(resolve('.saturn/screenshots-'));
const root=createProject(join(temp,'pumping-station'));
writeFileSync(join(root,'project.ts'), `import {
  alarm, autoHmi, cable, column, pipe, plc, project, pump, report, signal, tank, valve,
} from '@saturn/core';

export const reservoir = tank('TK-01', {
  label: { en: 'Supply tank', ru: 'Питающий резервуар' }, x: 40, y: 110,
  level: signal({ initial: 64, unit: '%', min: 0, max: 100, staleAfter: 5000 }),
});

export const booster = pump('P-01', {
  label: { en: 'Booster pump', ru: 'Повысительный насос' }, x: 330, y: 180,
  rpm: signal({ initial: 1450, unit: 'rpm', min: 0, max: 3000, staleAfter: 5000 }),
  run: signal({ initial: true, writable: true }),
  flow: signal({ initial: 18, unit: 'm³/h', min: 0, dimension: 'flow', staleAfter: 5000 }),
  pressure: signal({ initial: 2.95, unit: 'bar', min: 0, dimension: 'pressure', staleAfter: 5000 }),
});

export const outlet = valve('V-01', {
  label: { en: 'Outlet valve', ru: 'Выходной клапан' }, x: 650, y: 110,
  opening: signal({ initial: 75, unit: '%', writable: true, min: 0, max: 100 }),
});

export const controller = plc('PLC-01', {
  label: { en: 'Station controller', ru: 'Контроллер станции' }, x: 760, y: 360,
});

export const hourly = report('hourly-water', {
  label: { en: 'Hourly water flow', ru: 'Почасовой расход воды' },
  bucketMs: 3_600_000,
  columns: {
    flow: column(booster.flow, 'mean', { en: 'Flow', ru: 'Расход' }),
    pressure: column(booster.pressure, 'mean', { en: 'Pressure', ru: 'Давление' }),
    speed: column(booster.rpm, 'mean', { en: 'Speed', ru: 'Обороты' }),
  },
});

export default project({
  id: 'pumping-station',
  label: { en: 'Pumping station', ru: 'Насосная станция' },
  equipment: [reservoir, booster, outlet, controller],
  pipes: [
    pipe('suction', { from: reservoir.ports.outlet, to: booster.ports.inlet, flow: booster.flow }),
    pipe('discharge', { from: booster.ports.outlet, to: outlet.ports.inlet, flow: booster.flow }),
  ],
  cables: [
    cable('pump-start', { from: controller.ports.DO1, to: booster.ports.run, signal: booster.run }),
    cable('valve-command', { from: controller.ports.AO1, to: outlet.ports.command, signal: outlet.opening }),
  ],
  alarms: [alarm('high-pressure', {
    label: { en: 'High pressure', ru: 'Высокое давление' },
    signal: booster.pressure, above: 4.5, hysteresis: 0.2,
  })],
  reports: [hourly],
  hmi: autoHmi(controller),
});
`);
writeFileSync(join(root,'server.ts'), `import type { Driver, Value } from '@saturn/core';
import { booster, controller, outlet, reservoir } from './project';

const commands:Record<string,Value>={};
const driver:Driver={
  mode:'simulation',
  async start({project,snapshot,publish}){
    let disposed=false,elapsed=0,timer:ReturnType<typeof setTimeout>;
    for(const item of Object.values(project.signals)) commands[item.id]??=snapshot.samples[item.id]?.value??item.initial;
    const tick=async()=>{
      if(disposed)return;
      const running=commands[booster.run.id]===true;
      const opening=Number(commands[outlet.opening.id]??75);
      await publish({
        [reservoir.level.id]:64+Math.sin(elapsed++/20)*3,
        [booster.run.id]:running,
        [booster.rpm.id]:running?1450:0,
        [booster.flow.id]:running?opening*.24:0,
        [booster.pressure.id]:running?2+(100-opening)*.038:0,
        [outlet.opening.id]:opening,
        [controller.online.id]:true,
      });
      if(!disposed)timer=setTimeout(()=>void tick().catch(console.error),1000);
    };
    await tick();
    return()=>{disposed=true;clearTimeout(timer);};
  },
  async write(id,value){commands[id]=value;},
};
export default driver;
`);

const git=(...args:string[])=>Bun.spawnSync(['git','-C',root,...args],{stdout:'ignore',stderr:'pipe'});
git('init'); git('config','user.name','Saturn Screenshots'); git('config','user.email','screenshots@localhost');
git('add','.'); git('commit','-m','Screenshot fixture');

const fixtureProject={root,clean:()=>rmSync(temp,{recursive:true,force:true})};
const base='http://127.0.0.1:4017';
mkdirSync('docs/screenshots',{recursive:true});
// Documentation captures intentionally use a deterministic light Shell and a self-contained public DSL fixture.

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
  const page=await browser.newPage({viewport:{width:1536,height:864},deviceScaleFactor:1,colorScheme:'light'});
  await page.addInitScript(()=>{localStorage.setItem('saturn.locale','ru');localStorage.setItem('saturn.theme','light');});
  await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
  await page.goto(base);
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.locator('[data-equipment="P-01"]').waitFor({timeout:30000});

  const nav=page.getByRole('navigation',{name:'Рабочие разделы'});
  const capture=async(label:string,file:string,ready?:()=>Promise<void>)=>{
    await nav.getByRole('button',{name:label,exact:true}).click();
    if(ready)await ready();
    await page.waitForTimeout(120);
    if(await page.evaluate(()=>document.documentElement.dataset.theme)!=='light')throw new Error(`Screenshot ${file} is not using the light theme`);
    await page.screenshot({path:`docs/screenshots/${file}`,fullPage:false});
  };

  await page.screenshot({path:'docs/screenshots/diagram.png'});
  await capture('Исходник','source.png',async()=>{await page.locator('.cm-content').waitFor();});
  await capture('Сигналы','signals.png');
  await capture('Отчёты','reports.png');
  await capture('HMI','hmi.png',async()=>{await page.locator('.hmi-surface iframe').waitFor();});
  await capture('Среда исполнения','environment.png');
  await capture('Git','git.png');

  await nav.getByRole('button',{name:'Схема',exact:true}).click();
  await page.locator('[data-equipment="P-01"]').waitFor();
  await page.screenshot({path:'docs/screenshots/ide-light.png'});

  await page.getByRole('button',{name:'3D',exact:true}).click();
  await until(async()=>Number(await page.locator('.scene3d').getAttribute('data-frames'))>2,'3D did not render');
  await page.screenshot({path:'docs/screenshots/ide-3d.png'});

  await page.getByRole('button',{name:'2D',exact:true}).click();
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await server.exited;
  fixtureProject.clean();
}

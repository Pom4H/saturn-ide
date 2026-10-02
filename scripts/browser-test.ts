import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fixture } from '../tests/helpers';
import { execute } from '../src/workspace/git';
import type { IDEState } from '../src/protocol';
import { chooseExplorerMode } from './helpers/explorer-mode';
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw new Error(message);}
const fixtureProject=fixture(),base='http://127.0.0.1:4017';mkdirSync('artifacts',{recursive:true});
for(const args of [['init','-b','main'],['config','user.name','Saturn browser test'],['config','user.email','test@localhost'],['add','.'],['commit','-m','Initial project']])await execute(['git',...args],fixtureProject.root);
const server=Bun.spawn(['bun','dev'],{env:{...Bun.env,SATURN_PROJECT:fixtureProject.root,PORT:'4017',DATABASE_URL:':memory:',SATURN_PREVIEW:'simulation'},stdout:'pipe',stderr:'pipe'});
const stdout=new Response(server.stdout).text(),stderr=new Response(server.stderr).text();
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;const checks:string[]=[],errors:string[]=[];
const captureArtifacts=Bun.env.SATURN_CAPTURE_ARTIFACTS==='1';
const screenshot=async(page:Page,path:string)=>{if(captureArtifacts)await page.screenshot({path});};
const state=async()=>await(await fetch(`${base}/api/state`)).json() as IDEState;
const until=async(check:()=>Promise<boolean>,message:string)=>{for(let i=0;i<120;i++){if(await check().catch(()=>false))return;await Bun.sleep(250);}throw new Error(message);};
async function hoverPump(page:Page){
  const line=page.locator('.cm-line').filter({hasText:'const booster = pump'});await line.scrollIntoViewIfNeeded();
  const point=await line.evaluate(element=>{const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null;while((node=walker.nextNode())){const start=node.textContent?.indexOf('pump')??-1;if(start>=0){const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+4);const b=range.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2};}}return null;});
  assert(point,'pump token is not rendered');await page.mouse.move(point.x,point.y);await page.locator('.jsdoc').waitFor({timeout:15000});
}
try{
  await until(async()=>(await fetch(`${base}/api/state`)).ok,'bun dev did not start');
  assert((await state()).problems.length===0,JSON.stringify((await state()).problems));checks.push('actual bun dev starts with the typed demo project');
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await chooseExplorerMode(page,'Код');await page.getByRole('navigation',{name:'Рабочие области'}).getByRole('button',{name:'Объект',exact:true}).click();
  await page.locator('[data-equipment="P-01"] [data-rpm="1450"]').waitFor({timeout:30000});
  const activityNav=page.getByRole('tree',{name:'Структура проекта'}),rail=page.getByRole('navigation',{name:'Рабочие области'});
  const openSurface=async(name:string)=>{
    if(name==='Исходник'){
      await rail.getByRole('button',{name:'Объект',exact:true}).click();
      await chooseExplorerMode(page,'Код');
      await activityNav.getByRole('treeitem',{name:'P-01.device.ts',exact:true}).click();
      return;
    }
    const section:Record<string,string>={'Сигналы':'Мониторинг','Отчёты':'Отчёты','HMI':'Объект','Среда исполнения':'Среда','Git':'Изменения','Схема':'Объект'};
    const target=section[name];if(!target)throw new Error(`Unknown surface ${name}`);
    await rail.getByRole('button',{name:target,exact:true}).click();
    if(name==='HMI'){await chooseExplorerMode(page,'Объекты');await activityNav.getByRole('treeitem',{name:'HMI',exact:true}).click();}
  };
  const captureSurface=async(name:string,file:string,ready?:()=>Promise<void>)=>{await openSurface(name);if(ready)await ready();await screenshot(page,`artifacts/${file}`);};
  await screenshot(page,'artifacts/menu-diagram.png');
  await captureSurface('Исходник','menu-source.png',async()=>{await page.locator('.cm-content').waitFor();await page.locator('.cm-live-value').filter({hasText:/1[ ,\u00a0\u202f]?450 rpm/}).first().waitFor({timeout:15000});});checks.push('source editor renders live runtime values as virtual comments');
  await captureSurface('Сигналы','menu-signals.png');
  await captureSurface('Отчёты','menu-reports.png');
  await captureSurface('HMI','menu-hmi.png',async()=>{await page.locator('.hmi-surface iframe').waitFor();});
  await captureSurface('Среда исполнения','menu-environment.png');
  await captureSurface('Git','menu-git.png');
  await openSurface('Схема');await page.locator('[data-equipment="P-01"]').waitFor();
  checks.push('activity menu surfaces captured from the real shell');
  assert(await page.locator('[data-anatomy="saturn-pump"] circle').count()>=10,'original SVG anatomy lost');
  assert(await page.locator('[data-cable]').count()===2,'physical cables missing');assert(await page.locator('[data-route-valid="false"]').count()===0,'demo routing failed');
  assert(await page.locator('.unified-sidebar [data-icon="pump"]').count()>=1,'device class icon missing from sidebar');
  await openSurface('Исходник');await page.locator('.cm-content').waitFor();
  assert((await page.locator('.code-pane .pane-heading').innerText()).includes('P-01.device.ts'),'device opens its real named source');
  await activityNav.getByRole('treeitem',{name:'P-01.device.ts',exact:true}).click();
  await page.getByRole('button',{name:'Проекции',exact:true}).click();await page.getByRole('menuitem',{name:'Схема',exact:true}).click();
  assert(await page.locator('.unified-sidebar [data-icon="pump"]').count()>=1,'Explicit view navigation must preserve device identity');
  checks.push('one device resource, one named source and a consistent class icon across editors');
  await page.getByRole('button',{name:'Правка',exact:true}).click();
  const originalX=(await state()).project.equipment.find(e=>e.id==='P-01')!.x;
  const pipe=page.locator('[data-pipe="suction"] path').first(),before=await pipe.getAttribute('d'),pump=page.locator('[data-equipment="P-01"]'),box=await pump.boundingBox();assert(box,'pump not visible');
  // The authored loose run-command end is at x=155: moving the pump right by
  // more than 28 model units encloses that fixed free end. Exercise a clear
  // equipment drag here; blocked placement is covered by pipe-visual-browser-test.
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-35,box.y+box.height/2-12,{steps:6});await page.waitForTimeout(120);
  assert(await pipe.getAttribute('d')!==before,'pipe must follow before drop');assert((await state()).project.equipment.find(e=>e.id==='P-01')!.x===originalX,'drag saved before drop');
  await page.mouse.up();
  await until(async()=>(await state()).project.equipment.find(e=>e.id==='P-01')!.x!==originalX,'drop did not save source');
  assert(await page.locator('.scene [data-route-valid="false"]').count()===0,'2D graph has blocked routes after clear equipment drag');
  checks.push('2D drag updates routes before drop and persists the authored source after drop');
  await openSurface('Исходник');await hoverPump(page);assert((await page.locator('.jsdoc').innerText()).includes('Насос'),'RU JSDoc missing');await page.mouse.move(5,5);checks.push('RU JSDoc from actual TypeScript Language Service');await openSurface('Схема');
  const rotor=page.locator('[data-equipment="P-01"] [data-part="rotor"]');
  const phase=await rotor.getAttribute('data-phase');await page.waitForTimeout(150);assert(await rotor.getAttribute('data-phase')!==phase,'measured rotor must animate');
  const rotorCenterError=async()=>page.evaluate(()=>{const rotor=document.querySelector<SVGGElement>('[data-equipment="P-01"] [data-part="rotor"]'),equipment=rotor?.closest<SVGGElement>('[data-equipment="P-01"]');if(!rotor||!equipment)return Infinity;const cx=Number(rotor.dataset.originX),cy=Number(rotor.dataset.originY),point=new DOMPoint(cx,cy),actual=point.matrixTransform(rotor.getScreenCTM()!),expected=point.matrixTransform(equipment.getScreenCTM()!);return Math.hypot(actual.x-expected.x,actual.y-expected.y);});
  assert(await rotorCenterError()<.5,'pump impeller must rotate around its center independent of host CSS');
  await page.setViewportSize({width:1040,height:720});assert(await rotorCenterError()<.5,'pump impeller center drifted at embedded-hero viewport scale');await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(50);const still=await rotor.getAttribute('data-phase');await page.waitForTimeout(100);assert(await rotor.getAttribute('data-phase')===still,'reduced motion must freeze phase');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Свойства',exact:true}).click();
  await page.getByRole('button',{name:'Стоп',exact:true}).click();await page.locator('[data-rpm="0"]').waitFor();await page.getByRole('button',{name:'Пуск',exact:true}).click();await page.locator('[data-rpm="1450"]').waitFor();
  await page.getByRole('button',{name:'Закрыть свойства',exact:true}).click();await page.locator('[data-equipment="V-01"]').click();await page.getByRole('button',{name:'Свойства',exact:true}).click();await page.getByRole('spinbutton',{name:'V-01.opening'}).fill('0');await page.getByRole('button',{name:'Отправить',exact:true}).click();await until(async()=>!!(await state()).snapshot.alarms['high-pressure']?.active,'alarm not activated');
  await page.getByRole('button',{name:'Уведомления',exact:true}).click({force:true});await page.getByRole('button',{name:'Квитировать',exact:true}).click();await until(async()=>!!(await state()).snapshot.alarms['high-pressure']?.acknowledged,'ack not persisted');
  await page.getByRole('spinbutton',{name:'V-01.opening'}).fill('75');await page.getByRole('button',{name:'Отправить',exact:true}).click();await page.getByRole('button',{name:'Скрыть панель'}).click();checks.push('commands, measured SVG motion, reduced-motion and alarm acknowledgement use the actual runtime');
  await openSurface('Отчёты');await page.getByRole('button',{name:'Сформировать',exact:true}).click();await page.locator('.report-table tbody tr').first().waitFor();
  assert(await page.locator('.report-table td[data-coverage]').count()>0,'report coverage missing');await screenshot(page,'artifacts/report.png');checks.push('report surface reads SQL observations and displays missing-data coverage');
  await openSurface('Сигналы');await page.getByRole('button',{name:'P-01.pressure',exact:true}).click();await page.locator('.trend [data-series]').waitFor();
  await openSurface('Git');await page.getByRole('textbox',{name:'Описание коммита'}).fill('Move pump in Shell');await page.getByRole('button',{name:'Коммит',exact:true}).click();await until(async()=>!(await execute(['git','status','--porcelain'],fixtureProject.root)).trim(),'Git commit failed');checks.push('shared Shell navigation, archive chart and real Git commit');
  await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'Поиск',exact:true}).fill('P-01');await page.keyboard.press('Enter');await page.locator('[data-equipment="P-01"]').waitFor();checks.push('command palette finds equipment and opens its surface');
  await page.getByRole('button',{name:'3D',exact:true}).click();await until(async()=>Number(await page.locator('.scene3d').getAttribute('data-frames'))>3,'3D renderer did not produce frames');await screenshot(page,'artifacts/ide-3d.png');const invalidRoutes=await page.locator('.scene3d').getAttribute('data-invalid-routes');assert(invalidRoutes==='0',`3D graph differs from 2D: ${invalidRoutes} invalid routes`);assert(Number(await page.locator('.scene3d').getAttribute('data-pipe-bends'))>0,'3D pipe elbows are missing');checks.push('real WebGL 3D shares routes and rounds pipe bends');
  await page.getByRole('button',{name:'2D',exact:true}).click();await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});await screenshot(page,'artifacts/ide-light.png');await page.emulateMedia({colorScheme:'dark'});await screenshot(page,'artifacts/ide-dark.png');
  await page.setViewportSize({width:1024,height:768});await screenshot(page,'artifacts/ide-ipad.png');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');await screenshot(page,'artifacts/ide-mobile.png');
  await page.setViewportSize({width:320,height:240});await page.goto(`${base}/hmi`);await page.locator('[data-equipment="P-01"]').waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight),'HMI overflow');await screenshot(page,'artifacts/hmi-320x240.png');checks.push('real screenshots at desktop, tablet, phone and HMI viewports');
  assert(errors.length===0,errors.join('\n'));console.log(checks.map(c=>`PASS ${c}`).join('\n'));
}catch(error){errors.push(String(error));await browser?.contexts()[0]?.pages()[0]?.screenshot({path:'artifacts/failure.png'}).catch(()=>{});throw error;}
finally{await Bun.write('artifacts/browser-report.json',JSON.stringify({checks,errors},null,2));await browser?.close();server.kill('SIGTERM');await server.exited;await Bun.write('artifacts/server.log',`${await stdout}\n${await stderr}`);fixtureProject.clean();}

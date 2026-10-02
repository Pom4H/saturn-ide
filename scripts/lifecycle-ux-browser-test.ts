import { toggleShellDetails } from './helpers/shell-details';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {fixture} from '../tests/helpers';
import {createApp} from '../src/host/dev';

mkdirSync('artifacts/lifecycle-ux',{recursive:true});
const work=fixture();
const app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU',recordVideo:{dir:'artifacts/lifecycle-ux/video'}});
const page=await context.newPage(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
let reportRequests=0;
page.on('request',request=>{if(new URL(request.url()).pathname==='/api/report')reportRequests++;});
const rail=page.getByRole('navigation',{name:'Рабочие области'});
const tree=page.getByRole('tree',{name:'Структура проекта'});
const releases=async()=>fetch(new URL('/api/releases',app.server.url)).then(response=>response.json()) as Promise<{key:string;checked:string;published:string|null;applied:string|null}>;
const post=async(path:string,body:unknown)=>{
  const key=(await releases()).key;
  const response=await fetch(new URL(`/api/${path}`,app.server.url),{method:'POST',headers:{'Content-Type':'application/json','X-Saturn-Key':key},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};

try{
  await page.goto(app.server.url.href);
  await expect(rail).toBeVisible();
  await rail.locator('[data-rail-section="reports"]').click();
  await expect(page.locator('.report-pending')).toContainText('ожидает применения');
  await expect(page.getByRole('button',{name:'Сформировать',exact:true})).toBeDisabled();
  await page.screenshot({path:'artifacts/lifecycle-ux/report-checked-no-applied.png'});
  assert.equal(reportRequests,0,'Checked report requested runtime archive without Applied build');
  const noAppliedTo=Date.now();
  assert.equal((await fetch(new URL(`/api/report?id=hourly-water&from=${noAppliedTo-3600_000}&to=${noAppliedTo}`,app.server.url))).status,409,'Direct report API generated a Checked report without Applied');
  assert.equal((await fetch(new URL('/api/history?signal=TK-01.level',app.server.url))).status,409,'Direct history API exposed a Checked signal without Applied');
  assert.equal((await fetch(new URL(`/api/history/range?signal=TK-01.level&from=${noAppliedTo-3600_000}&to=${noAppliedTo}&points=60`,app.server.url))).status,409,'Direct range API exposed a Checked signal without Applied');

  await rail.locator('[data-rail-section="object"]').click();
  await tree.getByRole('treeitem',{name:'HMI',exact:true}).click();
  await expect(page.locator('.hmi-gallery article')).toHaveCount(0);
  await expect(page.locator('.hmi-surface').getByRole('status')).toContainText('В Applied пока нет экранов HMI');
  await page.screenshot({path:'artifacts/lifecycle-ux/hmi-checked-no-applied.png'});
  const directHmi=await context.newPage();
  await directHmi.goto(new URL('/hmi?screen=default',app.server.url).href);
  await expect(directHmi.getByText('Экран оператора ожидает применения сборки')).toBeVisible();
  await directHmi.close();

  const first=await releases();
  await post('publish',{hash:first.checked,expectedPublished:null});
  await post('apply',{hash:first.checked,expectedApplied:null});
  await expect(page.locator('.hmi-gallery article').first()).toBeVisible();
  await rail.locator('[data-rail-section="reports"]').click();
  await expect(page.getByRole('button',{name:'Сформировать',exact:true})).toBeEnabled();

  await Bun.write(join(work.root,'reports/flow.ts'),await Bun.file('examples/reports/flow.ts').text());
  const source=await Bun.file(join(work.root,'project.ts')).text();
  await Bun.write(join(work.root,'project.ts'),"import {flowReport} from './reports/flow';\n"+source.replace('reports: [hourlyWater]','reports: [hourlyWater,flowReport(booster.flow)]'));
  await app.reload();
  const next=await releases();
  assert.notEqual(next.checked,next.applied);
  await expect(page.getByLabel('Отчёт',{exact:true}).locator('option[value="flow-detail"]')).toHaveCount(1);
  await page.getByLabel('Отчёт',{exact:true}).selectOption('flow-detail');
  await expect(page.getByLabel('Отчёт',{exact:true})).toHaveValue('flow-detail');
  await expect(page.locator('.report-pending')).toContainText('ожидает применения');
  await expect(page.getByRole('button',{name:'Сформировать',exact:true})).toBeDisabled();
  await expect(page.locator('.report-preview h2')).toContainText('Расход');
  await page.screenshot({path:'artifacts/lifecycle-ux/report-new-checked.png'});
  assert.equal(reportRequests,0,'Selecting a Checked-only report requested an Applied report');
  await toggleShellDetails(page,'properties');
  const reportInspector=page.getByRole('complementary',{name:'Свойства объекта'});
  await expect(reportInspector.locator('.detail-identity')).toContainText('Расход · типизированный отчёт');
  await expect(reportInspector.getByRole('status')).toContainText('Есть в Checked, но ещё нет в Applied');
  await reportInspector.getByRole('button',{name:'Закрыть свойства'}).click();

  const oldReportPath=join(work.root,'reports/hourly-water.report.ts');
  await Bun.write(oldReportPath,(await Bun.file(oldReportPath).text()).replace('Почасовой расход воды','Почасовой расход воды · новая версия'));
  await app.reload();
  await page.getByLabel('Отчёт',{exact:true}).selectOption('hourly-water');
  await expect(page.locator('.report-pending')).toContainText('другое определение с тем же ID');
  await expect(page.getByRole('button',{name:'Сформировать',exact:true})).toBeDisabled();
  await toggleShellDetails(page,'properties');
  const changedReport=page.getByRole('complementary',{name:'Свойства объекта'});
  await expect(changedReport.locator('.detail-identity')).toContainText('Почасовой расход воды · новая версия');
  await expect(changedReport.getByRole('status')).toContainText('Checked ≠ Applied');
  await changedReport.getByRole('button',{name:'Закрыть свойства'}).click();
  assert.equal(reportRequests,0,'Changed Checked definition invoked the older Applied definition');

  const preview=await post('devices/create',{template:'pump',id:'P-02',label:'Дополнительный насос'}) as {projectVersion:string};
  await post('devices/create',{template:'pump',id:'P-02',label:'Дополнительный насос',projectVersion:preview.projectVersion,apply:true});
  await rail.locator('[data-rail-section="object"]').click();
  await tree.getByRole('treeitem',{name:'HMI',exact:true}).click();
  await page.getByRole('button',{name:'Создать HMI',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Создать HMI'});
  await expect(dialog.locator('.hmi-device-choice').filter({hasText:'P-02'})).toBeVisible();
  await expect(dialog.getByRole('group',{name:'Оборудование · Checked'})).toBeVisible();
  await page.screenshot({path:'artifacts/lifecycle-ux/hmi-checked-device.png'});
  await dialog.getByRole('button',{name:'Закрыть'}).click();

  await tree.locator('[data-resource-id="P-02"]').first().click();
  await toggleShellDetails(page,'properties');
  const inspector=page.getByRole('complementary',{name:'Свойства объекта'});
  await expect(inspector).toContainText('Дополнительный насос');
  await expect(inspector.getByRole('status')).toContainText('Есть в Checked, но ещё нет в Applied');
  await expect(inspector.locator('.detail-control')).toHaveCount(0);
  await expect(inspector.getByRole('heading',{name:'Параметры'})).toBeVisible();
  await page.screenshot({path:'artifacts/lifecycle-ux/device-checked-only.png'});

  const pumpPath=join(work.root,'equipment/P-01.device.ts');
  const pumpSource=await Bun.file(pumpPath).text();
  await Bun.write(pumpPath,pumpSource.replace('Повысительный насос','Повысительный насос · Checked').replace("pressure: signal({ initial: 0, unit: 'bar', min: 0, dimension:","pressure: signal({ initial: 0, unit: 'bar', min: 0, max: 6, dimension:"));
  await app.reload();
  await tree.locator('[data-resource-id="P-01"]').first().click();
  await expect(inspector.locator('.detail-identity')).toContainText('Повысительный насос · Checked');
  await expect(inspector.getByRole('status')).toContainText('Checked ≠ Applied');
  await expect(inspector.locator('.detail-control')).toContainText('Applied');
  await inspector.getByRole('button',{name:/^P-01.pressure/}).click();
  await expect(inspector.getByRole('heading',{name:'Контракт',exact:true})).toBeVisible();
  await expect(inspector.getByText('0 … 6',{exact:true})).toBeVisible();
  await expect(inspector.getByRole('status')).toContainText('Checked ≠ Applied');
  await expect(inspector.getByText('Показание · Applied')).toBeVisible();
  await expect(inspector.getByRole('button',{name:'История измерений · Applied'})).toBeVisible();
  await page.screenshot({path:'artifacts/lifecycle-ux/changed-signal-properties.png'});
  await rail.locator('[data-rail-section="monitor"]').click();
  await page.locator('.signals-surface tr[data-stage="changed"]').filter({hasText:'P-01.pressure'}).getByRole('button').click();
  await expect(page.locator('.signals-surface>.inspector-body').getByRole('status')).toContainText('Checked ≠ Applied');
  await expect(inspector.getByRole('status')).toContainText('Checked ≠ Applied');
  await expect(inspector.getByText('0 … 6',{exact:true})).toBeVisible();
  await expect(inspector.getByText('Показание · Applied')).toBeVisible();
  await page.screenshot({path:'artifacts/lifecycle-ux/changed-signal-cross-pane.png'});

  const withoutReports=(await Bun.file(join(work.root,'project.ts')).text()).replace('reports: [hourlyWater,flowReport(booster.flow)]','reports: []');
  await Bun.write(join(work.root,'project.ts'),withoutReports);
  await app.reload();
  await rail.locator('[data-rail-section="reports"]').click();
  await expect(page.getByRole('heading',{name:'Отчёты проекта'})).toBeVisible();
  await expect(page.getByLabel('Отчёт',{exact:true})).toHaveCount(0);
  assert.deepEqual(errors,[]);
  console.log('PASS Checked-only report, HMI and device lifecycle in real Chromium; Applied controls gated, authored details visible, no page errors');
}catch(error){await page.screenshot({path:'artifacts/lifecycle-ux/failure.png'});throw error;}
finally{await context.close();await browser.close();await app.close();work.clean();}

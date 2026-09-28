import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {chromium,expect} from 'playwright/test';
import {fixture} from '../tests/helpers';
import {createApp} from '../src/host/dev';

mkdirSync('artifacts/signals-lifecycle',{recursive:true});
const work=fixture();
const app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU'});
const page=await context.newPage(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
const row=(id:string)=>page.locator('.signals-surface>.table-scroll tbody tr').filter({has:page.getByRole('button',{name:id,exact:true})});
const releases=async()=>fetch(new URL('/api/releases',app.server.url)).then(response=>response.json()) as Promise<{key:string;checked:string;published:string|null;applied:string|null}>;
const post=async(path:string,body:unknown)=>{
  const key=(await releases()).key;
  const response=await fetch(new URL(`/api/${path}`,app.server.url),{method:'POST',headers:{'Content-Type':'application/json','X-Saturn-Key':key},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
};

try{
  await page.goto(app.server.url.href);
  await page.getByRole('navigation',{name:'Рабочие области'}).locator('[data-rail-section="monitor"]').click();
  await expect(row('P-01.pressure')).toHaveAttribute('data-stage','checked-only');
  await expect(row('P-01.pressure').locator('td').nth(2)).toHaveText('—');
  await row('P-01.pressure').getByRole('button',{name:'P-01.pressure'}).click();
  await expect(page.locator('.signals-surface>.inspector-body')).not.toContainText('Наблюдение · Applied');
  await page.screenshot({path:'artifacts/signals-lifecycle/checked-no-applied.png'});

  const first=await releases();
  await post('publish',{hash:first.checked,expectedPublished:null});
  await post('apply',{hash:first.checked,expectedApplied:null});
  await expect(row('P-01.pressure')).toHaveAttribute('data-stage','matching');
  await expect(page.locator('.signals-surface>.inspector-body')).toContainText('Наблюдение · Applied');

  const projectPath=join(work.root,'project.ts'),source=await Bun.file(projectPath).text();
  assert.ok(source.includes('  equipment: [reservoir'),'fixture project shape changed');
  const withTraining=source
    .replace('import { alarm, autoHmi, cable, pipe, project }','import { alarm, autoHmi, cable, pipe, project, signal }')
    .replace('export { reservoir, booster, outlet, controller };',"const training=signal('ml.training',{initial:0,unit:'bar',storage:{mode:'all'}});\nexport { reservoir, booster, outlet, controller };")
    .replace('  equipment: [reservoir','  signals:{training},\n  equipment: [reservoir');
  await Bun.write(projectPath,withTraining);
  const pressurePath=join(work.root,'equipment/P-01.device.ts'),pressureSource=await Bun.file(pressurePath).text();
  assert.ok(pressureSource.includes("unit: 'bar', min: 0, dimension:'pressure'"),'fixture pressure signal shape changed');
  await Bun.write(pressurePath,pressureSource.replace("unit: 'bar', min: 0, dimension:'pressure'","unit: 'bar', min: 0, staleAfter: 6000, dimension:'pressure'"));
  await app.reload();
  const changed=await releases();
  assert.notEqual(changed.checked,changed.applied);
  await expect(row('ml.training')).toHaveAttribute('data-stage','checked-only');
  await expect(row('P-01.pressure')).toHaveAttribute('data-stage','changed');
  let trainingHistoryRequests=0;
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/history'&&url.searchParams.get('signal')==='ml.training')trainingHistoryRequests++;});
  await row('ml.training').getByRole('button',{name:'ml.training'}).click();
  await expect(page.locator('.signals-surface>.inspector-body')).toContainText('Только Checked · ждёт применения');
  await expect(page.locator('.signals-surface>.inspector-body')).not.toContainText('Наблюдение · Applied');
  await expect(row('ml.training').locator('td').nth(1)).toContainText('—');
  await expect(row('ml.training').locator('td').nth(2)).toHaveText('—');
  await page.waitForTimeout(450);
  assert.equal(trainingHistoryRequests,0,'Checked-only signal requested runtime history');
  const historyResponse=await fetch(new URL('/api/history?signal=ml.training',app.server.url));
  assert.ok([404,409].includes(historyResponse.status),`Checked-only signal history returned ${historyResponse.status}`);
  const rangeResponse=await fetch(new URL(`/api/history/range?signal=ml.training&from=${Date.now()-60_000}&to=${Date.now()}&points=60`,app.server.url));
  assert.ok([404,409].includes(rangeResponse.status),`Checked-only signal range returned ${rangeResponse.status}`);
  await page.screenshot({path:'artifacts/signals-lifecycle/checked-only-selected.png'});

  await row('P-01.pressure').getByRole('button',{name:'P-01.pressure'}).click();
  await expect(page.locator('.signals-surface>.inspector-body')).toContainText('Определение и требования ниже взяты из Checked');
  await expect(page.locator('.signals-surface>.inspector-body')).toContainText('Наблюдение · Applied');
  await page.screenshot({path:'artifacts/signals-lifecycle/changed-contract.png'});

  await post('publish',{hash:changed.checked,expectedPublished:first.checked});
  await post('apply',{hash:changed.checked,expectedApplied:first.checked});
  await expect(row('ml.training')).toHaveAttribute('data-stage','matching');
  await Bun.write(projectPath,source);
  await app.reload();
  await expect(row('ml.training')).toHaveAttribute('data-stage','applied-only');
  await row('ml.training').getByRole('button',{name:'ml.training'}).click();
  await expect(page.locator('.signals-surface>.inspector-body')).toContainText('Сигнал остаётся в Applied, но удалён из Checked');
  await expect(page.locator('.signals-surface>.inspector-body')).toContainText('Наблюдение · Applied');
  await page.screenshot({path:'artifacts/signals-lifecycle/applied-only-selected.png'});

  await page.getByRole('combobox',{name:'Language'}).selectOption('en');
  await expect(row('ml.training')).toContainText('Applied only · removed in Checked');
  await expect(page.locator('.signals-surface>.inspector-body')).toContainText('This signal remains in Applied but was removed from Checked');
  await page.getByRole('combobox',{name:'Language'}).selectOption('ru');

  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.signals-surface')).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile Signals overflow horizontally');
  await page.screenshot({path:'artifacts/signals-lifecycle/mobile-applied-only.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS Signals Checked/Applied lifecycle in real Chromium: no Applied, matching, pending, changed, removed, history gate, mobile width; no page errors');
}catch(error){await page.screenshot({path:'artifacts/signals-lifecycle/failure.png'});throw error;}
finally{await context.close();await browser.close();await app.close();work.clean();}

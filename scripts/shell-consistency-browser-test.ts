import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from 'playwright/test';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';

const output='artifacts/shell-consistency';
mkdirSync(output,{recursive:true});
const work=fixture();
const app=await createApp({projectDir:work.root,dataDir:work.dir,databaseUrl:':memory:',port:0,preview:'manual'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:960},locale:'ru-RU'});
const page=await context.newPage(),errors:string[]=[];
page.on('pageerror',error=>errors.push(error.message));
const rail=page.getByRole('navigation',{name:'Рабочие области'});
const section=(id:string)=>rail.locator(`[data-rail-section="${id}"]`);

try{
  await page.goto(app.server.url.toString());
  await expect(section('object')).toBeVisible();
  await expect(page.locator('.project-mode')).toHaveCount(0);
  await page.locator('[data-tree-id="view:docs"]').click();
  const docs=page.locator('.documentation-surface');
  await expect(docs.getByRole('heading',{name:'Документация проекта'})).toBeVisible();
  await expect(docs.getByRole('status')).toHaveText('Нет применённой сборки (Applied)');
  await expect(docs).not.toContainText('Совпадает с applied');
  await expect(docs.locator('.project-document').last()).toBeVisible();
  await page.screenshot({path:`${output}/desktop-docs-no-applied.png`});

  await section('environment').click();
  const environment=page.locator('.environment-surface');
  await expect(environment.getByRole('heading',{name:'Среда исполнения',level:1})).toBeVisible();
  await expect(environment.getByRole('heading',{name:'План развёртывания',level:2})).toBeVisible();
  assert.equal(await environment.evaluate(node=>{
    const title=node.querySelector('h1'),plan=node.querySelector('.deployment-plan h2');
    return !!title&&!!plan&&!!(title.compareDocumentPosition(plan)&Node.DOCUMENT_POSITION_FOLLOWING);
  }),true,'environment title must precede deployment plan');
  const stageLabelHeight=await environment.locator('dt').filter({hasText:'Опубликовано (Published)'}).evaluate(node=>({height:node.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(node).lineHeight)}));
  assert.ok(stageLabelHeight.height<stageLabelHeight.lineHeight*1.4,'release stage label must fit one line on desktop');
  await page.screenshot({path:`${output}/desktop-environment.png`});

  await page.getByRole('button',{name:'Найти и открыть раздел, объект или файл'}).click();
  const palette=page.getByRole('dialog',{name:'Перейти к'});
  await palette.getByRole('textbox',{name:'Поиск'}).fill('absent-project-resource-7129');
  await expect(palette.getByRole('status')).toContainText('Ничего не найдено');
  await page.screenshot({path:`${output}/desktop-search-empty.png`});
  await palette.getByRole('textbox',{name:'Поиск'}).press('Escape');
  await expect(palette).toHaveCount(0);

  await page.getByRole('combobox',{name:'Language'}).selectOption('en');
  await page.locator('[data-rail-section="object"]').click();
  await expect(page.getByRole('button',{name:'Select',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'Language'}).selectOption('ru');

  let historyRequests=0;
  page.on('request',request=>{if(request.url().includes('/api/history?signal='))historyRequests++;});
  await section('monitor').click();
  await page.locator('.signals-surface .table-scroll').getByRole('button',{name:'P-01.pressure'}).click();
  await expect(page.locator('#panel-body-graphs')).toContainText('ожидает применения');
  assert.equal(historyRequests,0,'Checked-only signal requested runtime history before Apply');
  const release=await (await fetch(new URL('/api/releases',app.server.url))).json() as {key:string;checked:string};
  for(const [path,body] of [['publish',{hash:release.checked,expectedPublished:null}],['apply',{hash:release.checked,expectedApplied:null}]] as const){
    const response=await fetch(new URL(`/api/${path}`,app.server.url),{method:'POST',headers:{'Content-Type':'application/json','X-Saturn-Key':release.key},body:JSON.stringify(body)});
    assert.equal(response.status,200,`${path}: ${await response.text()}`);
  }
  await expect(page.locator('.signals-surface [data-stage="matching"]')).not.toHaveCount(0);
  await expect.poll(()=>historyRequests).toBeGreaterThan(0);
  await page.getByRole('tab',{name:'Оборудование'}).click();
  const hiddenHistoryRequests=historyRequests;
  await page.waitForTimeout(5500);
  assert.equal(historyRequests,hiddenHistoryRequests,'hidden history tab continued polling SQL');

  const mobile=await context.newPage();
  mobile.on('pageerror',error=>errors.push(error.message));
  await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(app.server.url.toString());
  await expect(mobile.locator('.shell-panel')).toHaveAttribute('data-open','false');
  await expect(mobile.locator('.diagram-workspace')).toBeVisible();
  await mobile.screenshot({path:`${output}/mobile-diagram-panel-collapsed.png`});
  const mobileRail=mobile.getByRole('navigation',{name:'Рабочие области'});
  await mobileRail.locator('[data-rail-section="reports"]').click();
  await expect(mobile.locator('.reports-surface')).toBeVisible();
  const height=await mobile.locator('.surface-content').evaluate(node=>node.getBoundingClientRect().height);
  assert.ok(height>500,`mobile report work area should remain usable, got ${height}px`);
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile shell overflows horizontally');
  await mobile.screenshot({path:`${output}/mobile-reports-panel-collapsed.png`});
  await mobile.getByRole('button',{name:'Показать панель'}).click();
  await expect(mobile.locator('.shell-panel')).toHaveAttribute('data-open','true');
  await mobile.screenshot({path:`${output}/mobile-reports-panel-open.png`});
  await mobile.getByRole('button',{name:'Скрыть панель'}).click();
  await mobileRail.locator('[data-rail-section="environment"]').click();
  await expect(mobile.locator('.environment-surface')).toBeVisible();
  await expect(mobile.locator('.environment-surface .identity-value').first()).toBeVisible();
  await expect(mobile.locator('.deployment-plan')).toContainText('targets/deployment.ts');
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile environment overflows horizontally');
  await mobile.screenshot({path:`${output}/mobile-environment-panel-collapsed.png`});
  const checkedIdentity=mobile.locator('.environment-surface .identity-value').first();
  await expect(checkedIdentity.locator('summary')).toHaveText(/^[a-f0-9]{12}$/);
  await checkedIdentity.locator('summary').click();
  await expect(checkedIdentity.locator('.identity-full code')).toHaveText(/^sha256:[a-f0-9]{64}$/);
  await mobile.screenshot({path:`${output}/mobile-environment-identity.png`});
  await mobile.close();

  assert.deepEqual(errors,[]);
  console.log('PASS shell semantics: no false project mode or Applied comparison, environment hierarchy, search empty state, RU/EN controls, hidden history stops SQL polling, fresh mobile panel and report work area; no page errors');
}finally{
  await context.close();
  await browser.close();
  await app.close();
  work.clean();
}

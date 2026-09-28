import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { expect, test } from 'bun:test';

test('GitHub Pages hero runs the actual 3D surface and keeps source and preview bidirectionally bound',async()=>{
  const root=resolve(import.meta.dir,'../dist-pages');
  const server=Bun.serve({port:0,async fetch(request){
    const pathname=new URL(request.url).pathname;
    const relative=pathname==='/'?'index.html':decodeURIComponent(pathname.slice(1));
    const path=resolve(root,relative);
    if(!path.startsWith(root))return new Response('Not found',{status:404});
    try{const bytes=await readFile(path);const type=extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html';return new Response(bytes,{headers:{'content-type':type}});}catch{return new Response('Not found',{status:404});}
  }});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1150}}),errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/`,{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:/Система начинается/}).waitFor();
    expect(await page.locator('.hero').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(16, 42, 39)');
    expect(await page.locator('.scene-host').evaluate(element=>element.getBoundingClientRect().height)).toBeGreaterThan(240);
    await page.locator('.scene3d canvas').waitFor();
    await page.waitForFunction(()=>Number(document.querySelector('.scene3d')?.getAttribute('data-frames')??0)>2);
    await page.screenshot({path:'/tmp/saturn-pages-desktop.png',fullPage:true});
    const opening=page.getByRole('slider',{name:'Открытие клапана'});
    await opening.fill('0');
    expect(await page.locator('.visual-card').getAttribute('data-preview-opening')).toBe('0');
    expect(await page.locator('.binding-status').innerText()).toContain('0.0 m³/h');
    expect(await page.locator('.cm-content').innerText()).toContain("opening: signal({ initial: 0, unit: '%'");
    const editor=page.getByRole('textbox',{name:'Редактируемый TypeScript-проект'});
    const source=await editor.innerText();
    await editor.fill(source.replace("initial: 68, unit: '%', min: 0, max: 100","initial: 41, unit: '%', min: 0, max: 100"));
    expect(await page.locator('.visual-card').getAttribute('data-preview-level')).toBe('41');
    await page.locator('.run-control').evaluate(element=>element.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
    await page.waitForFunction(()=>document.querySelector('.visual-card')?.getAttribute('data-preview-rpm')==='0');
    expect(await page.locator('.visual-card').getAttribute('data-preview-rpm')).toBe('0');
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await page.screenshot({path:'/tmp/saturn-pages-mobile.png',fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if(errors.length)throw new Error(errors.join('\n'));
    console.log(JSON.stringify({browser:'Chromium',viewport:'1440x1150',webgl:await page.locator('.scene3d canvas').count(),level:41,opening:0,runtime:'static browser preview'}));
  }finally{await browser.close();server.stop(true);}
},30000);

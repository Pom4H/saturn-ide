import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium,expect,type Locator} from 'playwright/test';
import {createProject} from '../src/workspace/project-template';
import {createApp} from '../src/host/dev';
import {isAttached,type ConnectionEnd} from '../src/core';
import {routeConnections} from '../src/topology';
import {chooseExplorerMode} from './helpers/explorer-mode';

const out=resolve('artifacts/tee-proof');mkdirSync(out,{recursive:true});mkdirSync(resolve('.saturn'),{recursive:true});
const temp=mkdtempSync(resolve('.saturn/tee-proof-')),root=createProject(join(temp,'project'));
const source=`import { pipe, project, pump, signal, tank, tee, valve } from '@saturn/core';

const qFeed=signal('split.feed',{initial:30,unit:'m³/h',staleAfter:2000});
const qA=signal('split.a',{initial:12,unit:'m³/h',staleAfter:2000});
const qB=signal('split.b',{initial:18,unit:'m³/h',staleAfter:2000});
const qMergeA=signal('merge.a',{initial:7,unit:'m³/h',staleAfter:2000});
const qMergeB=signal('merge.b',{initial:5,unit:'m³/h',staleAfter:2000});
const qMergeOut=signal('merge.out',{initial:12,unit:'m³/h',staleAfter:2000});
const qCrossA=signal('cross.a',{initial:4,unit:'m³/h',staleAfter:2000});
const qCrossB=signal('cross.b',{initial:6,unit:'m³/h',staleAfter:2000});

const splitSource=tank('TK-S',{label:'Split source',x:20,y:150});
const split=tee('T-S',{label:'Split tee',x:300,y:180});
const splitA=valve('V-SA',{label:'Split A',x:620,y:70});
const splitB=valve('V-SB',{label:'Split B',x:620,y:300});
const mergeA=tank('TK-MA',{label:'Merge A',x:20,y:600});
const mergeB=tank('TK-MB',{label:'Merge B',x:-250,y:330});
const merge=tee('T-M',{label:'Merge tee',x:390,y:620});
const mergeSink=pump('P-M',{label:'Merge sink',x:710,y:590});
const crossA=tank('TK-CA',{label:'Cross A source',x:960,y:40});
const crossASink=valve('V-CA',{label:'Cross A sink',x:1260,y:500});
const crossB=tank('TK-CB',{label:'Cross B source',x:1260,y:40});
const crossBSink=valve('V-CB',{label:'Cross B sink',x:960,y:500});

export default project({
  id:'tee-proof',label:'Pipe tee proof',
  equipment:[splitSource,split,splitA,splitB,mergeA,mergeB,merge,mergeSink,crossA,crossASink,crossB,crossBSink],
  pipes:[
    pipe('split-feed',{from:splitSource.ports.outlet,to:split.ports.left,flow:qFeed}),
    pipe('split-a',{from:split.ports.right,to:splitA.ports.inlet,flow:qA}),
    pipe('split-b',{from:split.ports.branch,to:splitB.ports.inlet,flow:qB}),
    pipe('merge-a',{from:mergeA.ports.outlet,to:merge.ports.left,flow:qMergeA}),
    pipe('merge-b',{from:mergeB.ports.outlet,to:merge.ports.branch,flow:qMergeB}),
    pipe('merge-out',{from:merge.ports.right,to:mergeSink.ports.inlet,flow:qMergeOut}),
    pipe('cross-a',{from:crossA.ports.outlet,to:crossASink.ports.inlet,flow:qCrossA,via:[{x:1160,y:390}]}),
    pipe('cross-b',{from:crossB.ports.outlet,to:crossBSink.ports.inlet,flow:qCrossB,via:[{x:1160,y:390}]}),
  ],
});
`;
writeFileSync(join(root,'project.ts'),source);
writeFileSync(join(root,'server.ts'),`import type {Driver} from '@saturn/core';
import project from './project';
const values=Object.fromEntries(Object.values(project.signals).map(signal=>[signal.id,signal.initial]));
const driver:Driver={mode:'simulation',async start({publish}){let stopped=false;const tick=async()=>{if(!stopped)await publish(values);};await tick();const timer=setInterval(()=>void tick(),500);return()=>{stopped=true;clearInterval(timer);};}};
export default driver;
`);
const git=(...args:string[])=>Bun.spawnSync(['git','-C',root,...args],{stdout:'ignore',stderr:'pipe'});
git('init','-b','main');git('config','user.name','Saturn Tee Proof');git('config','user.email','tee-proof@localhost');git('add','.');git('commit','-m','Tee proof fixture');

const app=await createApp({projectDir:root,dataDir:join(temp,'data'),databaseUrl:':memory:',port:0,preview:'simulation'});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:1,locale:'ru-RU',colorScheme:'light',recordVideo:{dir:out,size:{width:1600,height:1000}}});
const page=await context.newPage(),video=page.video(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const proof:{revision:string;cases:Record<string,unknown>;browserErrors:string[]}={revision:process.env.GITHUB_SHA??'local',cases:{},browserErrors:errors};
const pause=(ms=950)=>page.waitForTimeout(ms);
const wait=async(check:()=>Promise<boolean>|boolean,message:string)=>{for(let i=0;i<160;i++){try{if(await check())return;}catch{}await pause(100);}throw new Error(message);};
const edge=(id:string)=>app.state().project.pipes.find(item=>item.id===id);
const attached=(end:ConnectionEnd|undefined)=>!!end&&isAttached(end);
const port=(end:ConnectionEnd|undefined)=>end&&isAttached(end)?end.port:undefined;
const routes=()=>routeConnections(app.state().project);
const center=async(locator:Locator)=>{const box=await locator.boundingBox();assert(box,'Missing visible target');return{x:box.x+box.width/2,y:box.y+box.height/2};};
const drag=async(from:{x:number;y:number},to:{x:number;y:number},steps=14)=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps});await pause(250);await page.mouse.up();};
const caption=async(title:string,detail:string)=>{await page.evaluate(({title,detail})=>{let box=document.getElementById('tee-proof-caption');if(!box){box=document.createElement('div');box.id='tee-proof-caption';Object.assign(box.style,{position:'fixed',left:'50%',top:'16px',transform:'translateX(-50%)',zIndex:'2147483647',pointerEvents:'none',padding:'10px 14px',borderRadius:'8px',background:'rgba(5,18,25,.90)',color:'#f5fbff',font:'600 14px ui-monospace,monospace',boxShadow:'0 8px 28px rgba(0,0,0,.28)',maxWidth:'980px',textAlign:'center'});document.body.appendChild(box);}box.textContent=title+' — '+detail;},{title,detail});await pause();};
const rail=()=>page.getByRole('navigation',{name:'Рабочие области'});
const openDiagram=async()=>{await rail().getByRole('button',{name:'Объект',exact:true}).click();await page.locator('.diagram-workspace').waitFor();};
const openSource=async(query:string)=>{await rail().getByRole('button',{name:'Объект',exact:true}).click();await chooseExplorerMode(page,'Код');await page.getByRole('tree',{name:'Структура проекта'}).locator('[data-tree-id="file:project.ts"]').click();const code=page.locator('.source-workspace .code-pane');await code.waitFor();await code.locator('.cm-content').click();await page.keyboard.press(process.platform==='darwin'?'Meta+f':'Control+f');await page.keyboard.insertText(query);await page.keyboard.press('Enter');await page.keyboard.press('Escape');await pause(650);};
const save=async(next:string)=>{const file=app.workspace.read('project.ts'),response=await fetch(new URL('/api/file',app.server.url),{method:'POST',headers:{'content-type':'application/json','X-Saturn-Key':app.state().key},body:JSON.stringify({path:file.path,source:next,version:file.version})});assert.equal(response.status,200,await response.text());};
const checked=async()=>((await (await fetch(new URL('/api/releases',app.server.url))).json()) as {checked:string|null}).checked;
const shot=(name:string)=>page.screenshot({path:join(out,name+'.png'),fullPage:false});

let failure:unknown;
try{
  await page.addInitScript(()=>{localStorage.setItem('saturn.locale','ru');localStorage.setItem('saturn.theme','light');});
  await page.goto(app.server.url.href);await page.locator('.scene [data-equipment="T-S"]').waitFor({timeout:30000});await page.getByRole('button',{name:'Правка',exact:true}).click();

  assert.equal(await page.locator('.scene [data-equipment="T-S"] [data-port]').count(),3);
  assert.equal(Object.keys(app.state().project.equipment.find(item=>item.id==='T-S')?.ports??{}).length,3);
  const initialRoutes=routes();proof.cases.initialRoutes=initialRoutes.map(route=>({id:route.id,valid:route.valid,error:route.error,points:route.points}));
  const badInitial=initialRoutes.filter(route=>!route.valid).map(route=>({id:route.id,error:route.error}));
  assert.equal(badInitial.length,0,'Invalid initial routes: '+JSON.stringify(badInitial));
  proof.cases.splitMerge={split:['split-feed','split-a','split-b'],merge:['merge-a','merge-b','merge-out'],ports:['left','right','branch']};
  await caption('1/10 · SPLIT + MERGE','один tee(), три физических порта, split и merge одновременно');await shot('01-split-merge-2d');

  const ca=routes().find(route=>route.id==='cross-a'),cb=routes().find(route=>route.id==='cross-b');assert(ca&&cb);
  const waypoint={x:1160,y:390},passes=(route:typeof ca)=>route.points.slice(1).some((b,index)=>{const a=route.points[index]!;return (a.x===b.x&&a.x===waypoint.x&&waypoint.y>=Math.min(a.y,b.y)&&waypoint.y<=Math.max(a.y,b.y))||(a.y===b.y&&a.y===waypoint.y&&waypoint.x>=Math.min(a.x,b.x)&&waypoint.x<=Math.max(a.x,b.x));});
  assert(passes(ca)&&passes(cb),'Both crossing routes must pass through the authored waypoint');
  const devices=(id:string)=>{const item=edge(id);assert(item&&attached(item.from)&&attached(item.to));return new Set([item.from.device,item.to.device]);};
  const da=devices('cross-a'),db=devices('cross-b');assert([...da].every(id=>!db.has(id)));
  proof.cases.crossing={waypoint,crossAPath:ca.points,crossBPath:cb.points,topologyDevices:{crossA:[...da],crossB:[...db]}};
  await caption('2/10 · CROSSING ≠ CONNECTION','трубы проходят через одну точку, но не получают скрытого topology node');await shot('02-crossing-not-connection');

  const before2d=app.workspace.read('project.ts').source,teeBox=await page.locator('.scene [data-equipment="T-S"]').boundingBox();assert(teeBox);
  await drag({x:teeBox.x+teeBox.width/2,y:teeBox.y+teeBox.height/2},{x:teeBox.x+teeBox.width/2+55,y:teeBox.y+teeBox.height/2+28});
  await wait(()=>app.workspace.read('project.ts').source!==before2d,'2D drag did not update source');assert(routes().every(route=>route.valid));
  proof.cases.drag2d={tee:app.state().project.equipment.find(item=>item.id==='T-S')};
  await caption('3/10 · 2D DRAG → SOURCE','маршруты живые во время drag, x/y сохраняются в project.ts');await shot('03-drag-2d');

  const aPlug=await center(page.locator('[data-cable-plug="split-a.from"]'));await drag(aPlug,{x:aPlug.x,y:aPlug.y+130});
  await wait(()=>!attached(edge('split-a')?.from),'2D unplug did not create free end');assert(routes().find(route=>route.id==='split-a')?.valid);
  const bPlug=await center(page.locator('[data-cable-plug="split-b.from"]')),right=await center(page.locator('.scene [data-equipment="T-S"] [data-port="right"]'));await drag(bPlug,right);
  await wait(()=>port(edge('split-b')?.from)==='right','2D rewire failed');
  proof.cases.rewire2d={splitA:edge('split-a')?.from,splitB:edge('split-b')?.from};
  await caption('4/10 · 2D UNPLUG + REWIRE','split-a → free(); split-b → освободившийся T-S.right');await shot('04-unplug-rewire-2d');

  await openSource("pipe('split-a'");const after2d=app.workspace.read('project.ts').source;
  assert(/from\s*:\s*[_$A-Za-z][_$A-Za-z0-9]*\(split\.ports\.right\s*,\s*\{/.test(after2d),'Canonical free end is missing from source');
  assert(/pipe\(['"]split-b['"]\s*,\s*\{\s*from\s*:\s*split\.ports\.right/.test(after2d),'2D rewire is missing from source');
  await caption('5/10 · CANONICAL CODE','free() и новый endpoint существуют в TypeScript, не в отдельном UI-store');await shot('05-source-after-2d');

  await openDiagram();await page.getByRole('button',{name:'3D',exact:true}).click();const scene=page.locator('.scene3d');await scene.waitFor();await wait(async()=>Number(await scene.getAttribute('data-frames'))>8,'3D did not render');assert.equal(await scene.getAttribute('data-invalid-routes'),'0');
  const projection=()=>scene.evaluate(node=>({equipment:JSON.parse((node as HTMLElement).dataset.equipmentScreens??'[]') as {id:string;x:number;y:number}[],plugs:JSON.parse((node as HTMLElement).dataset.cablePlugs??'[]') as {id:string;end:string;x:number;y:number}[],ports:JSON.parse((node as HTMLElement).dataset.portScreens??'[]') as {device:string;port:string;x:number;y:number}[]}));
  let p=await projection(),plugB=p.plugs.find(item=>item.id==='split-b'&&item.end==='from'),branch=p.ports.find(item=>item.device==='T-S'&&item.port==='branch');assert(plugB&&branch);await drag(plugB,branch);
  await wait(()=>port(edge('split-b')?.from)==='branch','3D branch rewire failed');
  p=await projection();const plugA=p.plugs.find(item=>item.id==='split-a'&&item.end==='from'),right3d=p.ports.find(item=>item.device==='T-S'&&item.port==='right');assert(plugA&&right3d);await drag(plugA,right3d);
  await wait(()=>port(edge('split-a')?.from)==='right','3D free-end reconnect failed');assert(routes().every(route=>route.valid));
  proof.cases.rewire3d={splitA:edge('split-a')?.from,splitB:edge('split-b')?.from};
  await caption('6/10 · 3D REWIRE','те же authored endpoints: branch возвращён, free-end подключён к right');await shot('06-rewire-3d');

  p=await projection();const tee=p.equipment.find(item=>item.id==='T-S');assert(tee);const before3d=app.workspace.read('project.ts').source;await drag(tee,{x:tee.x-45,y:tee.y+18});
  await wait(()=>app.workspace.read('project.ts').source!==before3d,'3D drag did not update source');await wait(async()=>await scene.getAttribute('data-invalid-routes')==='0','3D drag made invalid route');
  proof.cases.drag3d={tee:app.state().project.equipment.find(item=>item.id==='T-S')};
  await caption('7/10 · 3D DRAG → SOURCE','3D меняет те же x/y; отдельной 3D topology model нет');await shot('07-drag-3d');

  await openSource("tee('T-S'");const good=app.workspace.read('project.ts').source,checkedGood=await checked();
  assert(good.includes("pipe('split-a',{from:split.ports.right"));assert(good.includes("pipe('split-b',{from:split.ports.branch"));
  await caption('8/10 · SOURCE AFTER 2D + 3D','финальные координаты и right/branch endpoints видны в одном project.ts');await shot('08-source-final');

  const occupied=good.replace("pipe('split-b',{from:split.ports.branch","pipe('split-b',{from:split.ports.right");assert.notEqual(occupied,good);await save(occupied);
  await wait(()=>app.state().problems.some(problem=>problem.code==='PORT_OCCUPIED'),'occupied port was accepted');await expect(page.locator('.cm-lintRange-error, .cm-lintPoint-error').first()).toBeVisible({timeout:15000});assert.equal(await checked(),checkedGood);
  proof.cases.portOccupied={problems:app.state().problems.filter(problem=>problem.code==='PORT_OCCUPIED'),checkedRetained:true};
  await caption('9/10 · PORT OCCUPIED — REJECT','две трубы на T-S.right: draft блокируется, Checked не меняется');await shot('09-port-occupied-source');

  await openDiagram();assert(routes().every(route=>route.valid));await page.getByRole('button',{name:'3D',exact:true}).click();await wait(async()=>await page.locator('.scene3d').getAttribute('data-invalid-routes')==='0','invalid draft leaked into 3D');
  await caption('9/10 · INVALID DRAFT ISOLATED','2D/3D продолжают показывать последний Checked graph');await shot('09b-invalid-isolated-3d');
  await save(good);await wait(()=>!app.state().problems.some(problem=>problem.code==='PORT_OCCUPIED'),'recovery after occupied port failed');

  await openSource("pipe('merge-out'");const good2=app.workspace.read('project.ts').source,checked2=await checked();
  const wrong=good2.replace("pipe('merge-out',{from:merge.ports.right,to:mergeSink.ports.inlet","pipe('merge-out',{from:mergeSink.ports.inlet,to:merge.ports.right");assert.notEqual(wrong,good2);await save(wrong);
  await wait(()=>app.state().problems.length>0,'wrong direction was accepted');await expect(page.locator('.cm-lintRange-error, .cm-lintPoint-error').first()).toBeVisible({timeout:15000});assert.equal(await checked(),checked2);
  proof.cases.wrongDirection={problems:app.state().problems,checkedRetained:true};
  await caption('10/10 · SINK-AS-SOURCE — REJECT','mergeSink.inlet нельзя использовать как from; Checked остаётся прежним');await shot('10-wrong-direction-source');
  await save(good2);await wait(()=>app.state().problems.length===0,'recovery after direction test failed');

  await openDiagram();await page.getByRole('button',{name:'2D',exact:true}).click();await caption('DONE · REAL SATURN SHELL','split, merge, crossing, 2D/3D drag+rewire, source-first и invalid-draft safety доказаны');await shot('11-final-2d');
  assert.deepEqual(errors,[]);
}catch(error){failure=error;try{await page.screenshot({path:join(out,'failure.png'),fullPage:false});}catch{}}
finally{
  proof.browserErrors=[...errors];await Bun.write(join(out,'proof.json'),JSON.stringify(proof,null,2));await context.close();await browser.close();
  if(video){const recorded=await video.path();copyFileSync(recorded,join(out,'tee-proof.webm'));const ffmpeg=Bun.which('ffmpeg');if(ffmpeg){const result=Bun.spawnSync([ffmpeg,'-y','-i',recorded,'-movflags','+faststart','-pix_fmt','yuv420p',join(out,'tee-proof.mp4')],{stdout:'ignore',stderr:'pipe'});if(result.exitCode!==0)await Bun.write(join(out,'ffmpeg-error.txt'),new TextDecoder().decode(result.stderr));}}
  await app.close();rmSync(temp,{recursive:true,force:true});
}
if(failure)throw failure;
console.log('PASS tee proof: 10 edge cases in real source/2D/3D; video, screenshots and JSON recorded.');

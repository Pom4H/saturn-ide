import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createProject} from '../src/workspace/project-template';
import {Workspace} from '../src/workspace/files';
import {Builder} from '../src/workspace/build';
import {previewDevice} from '../src/workspace/scaffold';
import {application} from '../src/host/application';
// This test also runs first or alone on a clean checkout; do not depend on fixture order.
mkdirSync(resolve('.saturn'),{recursive:true});
test('fresh project has one model and optional folders; generated devices check without copying IDE or station infrastructure',async()=>{
 const base=mkdtempSync(resolve('.saturn/project-template-')),root=join(base,'my-station'),data=join(base,'data');mkdirSync(data);
 const directory=createProject(root),workspace=new Workspace(directory),builder=new Builder(workspace,resolve('.'),data);
 try{
  expect(readdirSync(root).sort()).toEqual(['.gitignore','README.md','package.json','project.ts','tsconfig.json']);
  const metadata=JSON.parse(readFileSync(join(root,'package.json'),'utf8')) as {dependencies:Record<string,string>};
  expect(metadata.dependencies['@saturn/core']).toBe('git+https://github.com/Pom4H/saturn-ide.git#67c596e20bd9cc05ee890e26e56f0892a62390f2');
  expect(readFileSync(join(root,'README.md'),'utf8')).toContain('Checked build');
  const initial=await builder.build();expect(initial.project.equipment).toHaveLength(0);expect(initial.artifact.driver).toBeNull();
  const device=previewDevice(workspace,'pump','P-01','Water pump');workspace.createAndAttach(device.path,device.source,device.projectSource,device.projectVersion);
  expect((await builder.build()).project.equipment[0]?.id).toBe('P-01');expect(()=>createProject(root)).toThrow('already exists');
 }finally{builder.close();rmSync(base,{recursive:true,force:true});}
});
test('init CLI accepts explicit template and rejects missing projects before starting a host',async()=>{
 const base=mkdtempSync(resolve('.saturn/project-init-')),root=join(base,'plant'),long=join(base,'X'.repeat(110));
 try{
  await application(['init',root,'--template','empty']);
  expect(readdirSync(root).sort()).toEqual(['.gitignore','README.md','package.json','project.ts','tsconfig.json']);
  await expect(application(['init',join(base,'invalid'),'--template','unknown'])).rejects.toThrow('Expected --template');
  await expect(application(['serve','--project',join(base,'missing')])).rejects.toThrow('Saturn project not found');
  createProject(long);
  const id=JSON.parse(readFileSync(join(long,'package.json'),'utf8')).name as string;
  expect(id.length).toBeLessThanOrEqual(80);
 }finally{rmSync(base,{recursive:true,force:true});}
});

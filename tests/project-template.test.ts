import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createProject} from '../src/workspace/project-template';
import {Workspace} from '../src/workspace/files';
import {Builder} from '../src/workspace/build';
import {previewDevice} from '../src/workspace/scaffold';
test('fresh project has one model and optional folders; generated devices check without copying IDE or station infrastructure',async()=>{
 const base=mkdtempSync(resolve('.saturn/project-template-')),root=join(base,'my-station'),data=join(base,'data');mkdirSync(data);
 const directory=createProject(root),workspace=new Workspace(directory),builder=new Builder(workspace,resolve('.'),data);
 try{
  expect(readdirSync(root).sort()).toEqual(['.gitignore','README.md','package.json','project.ts','tsconfig.json']);
  const initial=await builder.build();expect(initial.project.equipment).toHaveLength(0);expect(initial.artifact.driver).toBeNull();
  const device=previewDevice(workspace,'pump','P-01','Water pump');workspace.createAndAttach(device.path,device.source,device.projectSource,device.projectVersion);
  expect((await builder.build()).project.equipment[0]?.id).toBe('P-01');expect(()=>createProject(root)).toThrow('already exists');
 }finally{builder.close();rmSync(base,{recursive:true,force:true});}
});

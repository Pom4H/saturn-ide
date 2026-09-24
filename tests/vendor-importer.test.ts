import { expect,test } from 'bun:test';
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import lanmon4 from '@saturn/importers/lanmon4';
import type { ScadaImportSource } from '../src/core';
import { Workspace } from '../src/workspace/files';
import { applyImportPlan } from '../src/workspace/importers';
import { Builder } from '../src/workspace/build';
import { appRoot } from './helpers';

const bytes=(value:string)=>new TextEncoder().encode(value);
const source=(files:Record<string,Uint8Array>):ScadaImportSource=>({
  name:'legacy.zip',fingerprint:'b'.repeat(64),
  totalBytes:Object.values(files).reduce((sum,file)=>sum+file.byteLength,0),
  files:Object.entries(files).map(([path,file])=>({path,bytes:file,sha256:'0'.repeat(64)})),
});

test('external vendor importer lowers LanMon project into a buildable Saturn project',async()=>{
  const dir=mkdtempSync(join(appRoot,'.saturn','vendor-import-')),root=join(dir,'project');mkdirSync(root,{recursive:true});
  writeFileSync(join(root,'project.ts'),"import { project } from '@saturn/core';\nexport default project({id:'blank',label:'Blank',equipment:[],pipes:[],alarms:[]});\n");
  const workspace=new Workspace(root),plan=await lanmon4.import(source({
    'LANMON.INI':bytes('[Description]\nName=Boiler 7\n[MAP]\nMAP0=Main\n'),
    'MAP/Main.lm2':bytes('[SETUP]\nNAME=Main\nWidth=800\nHeight=600\nColor=16777215\n[OBJ1]\nObjType=2\nX=110\nY=65\nWidth=100\nHeight=30\nADDR=Boiler.Temp\nText=T=%VALUE\n'),
  }));
  try{
    expect(plan.diagnostics.some(issue=>issue.severity==='blocker')).toBe(false);
    applyImportPlan(workspace,plan,workspace.read('project.ts').version);
    const builder=new Builder(workspace,appRoot,join(dir,'data'));
    try{
      const built=await builder.build();
      expect(built.project.hmis).toHaveLength(1);
      expect(Object.values(built.project.signals).some(signal=>signal.binding?.protocol==='lanmon4'&&signal.binding.address==='Boiler.Temp')).toBe(true);
      const element=built.project.hmis?.[0]?.elements?.find(item=>item.id==='obj1');
      expect(element).toMatchObject({kind:'text',x:60,y:50,width:100,height:30});
    }finally{builder.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});

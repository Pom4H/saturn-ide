import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execute } from './git';
import { hash, HttpError, type Workspace } from './files';
export interface PluginPin {name:string;repository:string;ref:string;directory?:string;revision:string;files:Record<string,string>}
export interface PluginStatus {name:string;repository:string;ref:string;directory?:string;revision:string;latest?:string;update:boolean;modified:boolean;error?:string}
const metadata='saturn-provenance.json';
export class ProjectPlugins {
  private updates=new Map<string,{latest?:string;error?:string}>();
  private busy=false;
  constructor(private workspace:Workspace){}
  private root(){return join(this.workspace.root,'plugins');}
  private tree(root:string){const files:Record<string,string>={};let bytes=0;const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.name==='node_modules')throw new HttpError(400,'Dependencies must not vendor node_modules');if(entry.name==='.git'||entry.name===metadata)continue;const full=join(dir,entry.name),path=relative(root,full).replaceAll('\\','/');if(entry.isSymbolicLink())throw new HttpError(400,'Plugin symlinks are not allowed');if(entry.isDirectory())walk(full);else if(entry.isFile()){const content=readFileSync(full);bytes+=content.length;if(bytes>50_000_000||Object.keys(files).length>=5000)throw new HttpError(413,'Plugin exceeds source-copy limits');files[path]=hash(content.toString('base64'));}}};walk(root);return files;}
  private pins():PluginPin[]{if(!existsSync(this.root()))return [];return readdirSync(this.root()).filter(name=>/^[a-z][a-z0-9-]{0,63}$/.test(name)).flatMap(name=>{const dir=join(this.root(),name);if(lstatSync(dir).isSymbolicLink()||!existsSync(join(dir,metadata)))return [];const pin=JSON.parse(readFileSync(join(dir,metadata),'utf8')) as PluginPin;if(pin.name!==name||!pin.repository||!pin.ref||!pin.revision||!pin.files)throw new HttpError(400,'Invalid plugin provenance');return [pin];});}
  list():PluginStatus[]{return this.pins().map(pin=>{const known=this.updates.get(pin.name);return {...pin,files:undefined,...known,update:!!known?.latest&&known.latest!==pin.revision,modified:JSON.stringify(this.tree(join(this.root(),pin.name)))!==JSON.stringify(pin.files)};});}
  private validate(repository:string,ref:string){if(!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(repository)||!ref||ref.startsWith('-')||ref.includes('..')||!/^[@A-Za-z0-9_./-]+$/.test(ref))throw new HttpError(400,'Use an HTTPS GitHub repository and a branch or tag');}
  async check(){for(const pin of this.pins()){try{this.validate(pin.repository,pin.ref);const out=await execute(['git','ls-remote','--',pin.repository,`refs/heads/${pin.ref}`,`refs/tags/${pin.ref}`,`refs/tags/${pin.ref}^{}`],this.workspace.root);const lines=out.trim().split('\n').filter(Boolean),latest=(lines.find(line=>line.endsWith('^{}'))??lines[0])?.split(/\s/)[0];if(!latest)throw new Error('Tracked branch/tag not found');this.updates.set(pin.name,{latest});}catch(error){this.updates.set(pin.name,{error:String(error)});}}return this.list();}
  async install(name:string,repository:string,ref:string,expected?:string,directory=""){
    if(this.busy)throw new HttpError(409,'Another plugin operation is running');this.validate(repository,ref);if(!/^[a-z][a-z0-9-]{0,63}$/.test(name))throw new HttpError(400,'Invalid plugin folder name');
    if(directory&&(!/^[A-Za-z0-9_./-]+$/.test(directory)||directory.startsWith('/')||directory.split('/').some(part=>!part||part==='.'||part==='..')))throw new HttpError(400,'Invalid source directory');
    this.busy=true;const temp=mkdtempSync(join(tmpdir(),'saturn-plugin-'));
    try{
      const target=join(this.root(),name),old=this.pins().find(pin=>pin.name===name);
      if(existsSync(target)&&(!old||!expected))throw new HttpError(409,'Plugin folder already exists');
      if(expected&&(!old||old.revision!==expected||old.repository!==repository||old.ref!==ref||(old.directory??'')!==directory))throw new HttpError(409,'Plugin changed; refresh before updating');
      const assertClean=()=>{if(old&&JSON.stringify(this.tree(target))!==JSON.stringify(old.files))throw new HttpError(409,'Plugin has local changes; preserve or commit them before replacing copied sources');};assertClean();
      const checkout=join(temp,'checkout');await execute(['git','-c','core.hooksPath=/dev/null','clone','--depth','1','--single-branch','--branch',ref,'--',repository,checkout],temp,60000);
      const revision=(await execute(['git','rev-parse','HEAD'],checkout)).trim(),source=directory?join(checkout,directory):checkout; if(!existsSync(source)||lstatSync(source).isSymbolicLink())throw new HttpError(400,'Source directory not found');const files=this.tree(source);
      const pin:PluginPin={name,repository,ref,...(directory?{directory}:{}),revision,files};rmSync(join(checkout,'.git'),{recursive:true,force:true});writeFileSync(join(source,metadata),JSON.stringify(pin,null,2)+'\n');
      mkdirSync(this.root(),{recursive:true});if(lstatSync(this.root()).isSymbolicLink())throw new HttpError(403,'Unsafe plugin directory');
      // Stage on the same volume and atomically swap only after checking local files again.
      const stage=join(this.root(),`.stage-${crypto.randomUUID()}`),backup=join(this.root(),`.backup-${crypto.randomUUID()}`);cpSync(source,stage,{recursive:true});
      try{assertClean();if(old)renameSync(target,backup);try{renameSync(stage,target);}catch(error){if(old)renameSync(backup,target);throw error;}if(old)rmSync(backup,{recursive:true,force:true});}finally{rmSync(stage,{recursive:true,force:true});}
      this.updates.delete(name);return this.list();
    }finally{this.busy=false;rmSync(temp,{recursive:true,force:true});}
  }
}

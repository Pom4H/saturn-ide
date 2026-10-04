import {existsSync,mkdirSync,writeFileSync,cpSync,readFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {projectTemplateFiles,projectTemplateId} from './project-template-files';
export interface ProjectTemplateOptions {template?:'empty'|'pumping-station'|'smart-home';example?:string}
/** Minimal authored project; the complete station remains an explicit example template. */
export function createProject(destination:string,options:ProjectTemplateOptions={}){
 const target=resolve(destination),name=basename(target),id=projectTemplateId(name);
 if(existsSync(target))throw new Error('Destination already exists');
 if(options.template==='pumping-station'||options.template==='smart-home'){
  const external=options.example??Bun.env.SATURN_EXAMPLE;if(!external)throw new Error('Example templates are external project source. Pass example or set SATURN_EXAMPLE.');
  const source=resolve(external);
  if(!existsSync(join(source,'project.ts')))throw new Error('Example not found. Set SATURN_EXAMPLE to a project checkout.');
  cpSync(source,target,{recursive:true,filter:path=>!basename(path).startsWith('.')&&basename(path)!=='node_modules'});
  const pkg=JSON.parse(readFileSync(join(target,'package.json'),'utf8'));writeFileSync(join(target,'package.json'),JSON.stringify({...pkg,name:id,private:true},null,2)+'\n');
 }else{
  mkdirSync(dirname(target),{recursive:true});
  // Reserve this destination exclusively before writing any authored file.
  mkdirSync(target);
  for(const [path,content] of Object.entries(projectTemplateFiles(name)))writeFileSync(join(target,path),content);
 }
 writeFileSync(join(target,'.gitignore'),'node_modules/\n.saturn/\n.env\n.env.*\n');return target;
}

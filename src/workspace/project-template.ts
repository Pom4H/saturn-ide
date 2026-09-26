import {existsSync,mkdirSync,writeFileSync,cpSync,readFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
export interface ProjectTemplateOptions {template?:'empty'|'pumping-station';example?:string}
/** Minimal authored project; the complete station remains an explicit example template. */
export function createProject(destination:string,options:ProjectTemplateOptions={}){
 const target=resolve(destination),name=basename(target),id=name.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/^-+|-+$/g,'')||'project';
 if(existsSync(target))throw new Error('Destination already exists');
 if(options.template==='pumping-station'){
  const source=resolve(options.example??Bun.env.SATURN_EXAMPLE??join(import.meta.dir,'../../../saturn-examples/pumping-station'));
  if(!existsSync(join(source,'project.ts')))throw new Error('Station example not found. Set SATURN_EXAMPLE to a project checkout.');
  cpSync(source,target,{recursive:true,filter:path=>!basename(path).startsWith('.')&&basename(path)!=='node_modules'});
  const pkg=JSON.parse(readFileSync(join(target,'package.json'),'utf8'));writeFileSync(join(target,'package.json'),JSON.stringify({...pkg,name:id,private:true},null,2)+'\n');
 }else{
  mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'project.ts'),`import { project } from '@saturn/core';\n\nexport default project({\n  id: ${JSON.stringify(id)},\n  label: ${JSON.stringify(name)},\n  equipment: [],\n  pipes: [],\n  alarms: [],\n  reports: [],\n});\n`);
  writeFileSync(join(target,'package.json'),JSON.stringify({name:id,private:true,type:'module',scripts:{check:'tsc --noEmit'},dependencies:{'@saturn/core':'git+https://github.com/Pom4H/saturn-ide.git#main'},devDependencies:{typescript:'npm:@typescript/typescript6@6.0.2','@types/bun':'^1.4.0'}},null,2)+'\n');
  writeFileSync(join(target,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noUncheckedIndexedAccess:true,module:'Preserve',moduleResolution:'Bundler',noEmit:true,target:'ESNext',jsx:'react-jsx',skipLibCheck:true}},null,2)+'\n');
  writeFileSync(join(target,'README.md'),`# ${name}\n\nOpen with \`saturn gui --project .\`. The installed IDE supplies the editor, compiler and runtime host.\n\nStart with \`project.ts\`: the single typed model. Add equipment from the IDE explorer or ordinary TypeScript imports. No simulator or physical driver is connected yet.\n\nFor external TypeScript tools, run \`bun install\` and \`bun run check\`. Commit the resulting \`bun.lock\` to pin the dependency revision.\n\nCreate folders only when their content is needed:\n\n- \`equipment/\`: one file for a simple device; a folder for a device with its own views, driver or firmware.\n- \`reports/\`: typed report definitions.\n- \`hmi/\`: operator screens.\n- \`targets/\`: deployment plans and target configuration.\n- \`tests/\`: project acceptance scenarios.\n\n\`server.ts\` is optional: it exports an explicitly chosen driver. \`browser.ts\` is optional: it exports custom browser display factories. Neither file contains the IDE implementation. Extensions are project-owned source connected by ordinary imports.\n\nSaving source does not apply it to physical equipment. Publish/apply and deployment are explicit operations.\n`);
 }
 writeFileSync(join(target,'.gitignore'),'node_modules/\n.saturn/\n.env\n.env.*\n');return target;
}

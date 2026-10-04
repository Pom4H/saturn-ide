// A published Git revision with package exports. Keep this pin in step with IDE releases;
// a moving branch can resolve from an old Bun cache and leave @saturn/core unresolvable.
const starterCore='git+https://github.com/Pom4H/saturn-ide.git#67c596e20bd9cc05ee890e26e56f0892a62390f2';

/** Repository-safe identifier shared by local and cloud starters. */
export function projectTemplateId(name:string):string { return name.toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'')||'project'; }

/** Authored files only; usable by filesystem and Git hosts without executing a project. */
export function projectTemplateFiles(name:string):Record<string,string> {
  const id=projectTemplateId(name),files:Record<string,string>={};
  files['project.ts'] = `import { project } from '@saturn/core';\n\nexport default project({\n  id: ${JSON.stringify(id)},\n  label: ${JSON.stringify(name)},\n  equipment: [],\n  pipes: [],\n  alarms: [],\n  reports: [],\n});\n`;
  files['package.json'] = JSON.stringify({name:id,private:true,type:'module',scripts:{check:'tsc --noEmit'},dependencies:{'@saturn/core':starterCore},devDependencies:{typescript:'npm:@typescript/typescript6@6.0.2','@types/bun':'^1.4.0'}},null,2)+'\n';
  files['tsconfig.json'] = JSON.stringify({compilerOptions:{strict:true,noUncheckedIndexedAccess:true,module:'Preserve',moduleResolution:'Bundler',noEmit:true,target:'ESNext',jsx:'react-jsx',skipLibCheck:true}},null,2)+'\n';
  files['README.md'] = `# ${name}\n\nOpen this directory with \`saturn gui --project .\`. From a Saturn IDE source checkout, run \`bun start gui --project <path-to-this-directory>\` there. The IDE supplies the editor, compiler and runtime host.\n\nStart with \`project.ts\`: the single typed model. Add equipment from the IDE explorer or ordinary TypeScript imports. The IDE checks this starter on open without installing dependencies here. A Checked build means the source compiled; no simulator or physical driver is connected yet, so observations and Applied remain empty.\n\nFor a separate TypeScript check in this directory, run \`bun install\` and \`bun run check\`. Commit the resulting \`bun.lock\` to record the complete dependency graph. The Git dependency is optional for using the IDE, but required for standalone TypeScript tooling.\n\nCreate folders only when their content is needed:\n\n- \`equipment/\`: one file for a simple device; a folder for a device with its own views, driver or firmware.\n- \`reports/\`: typed report definitions.\n- \`hmi/\`: operator screens.\n- \`targets/\`: deployment plans and target configuration.\n- \`tests/\`: project acceptance scenarios.\n\n\`server.ts\` is optional: it exports an explicitly chosen driver. \`browser.ts\` is optional: it exports custom browser display factories. Neither file contains the IDE implementation. Extensions are project-owned source connected by ordinary imports.\n\nSaving source does not apply it to physical equipment. Automatic development preview applies only a declared simulator and can be disabled with \`--manual\`. Publish/apply and deployment are explicit operations.\n`;
  files['.gitignore']='node_modules/\n.saturn/\n.env\n.env.*\n';
  return files;
}

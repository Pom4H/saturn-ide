import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
export function scaffold(kind: string, name: string, projectRoot = resolve(Bun.env.SATURN_PROJECT ?? '.')) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw new Error('Use a lowercase name: plc-01');
  if (kind !== 'plc' && kind !== 'plugin') throw new Error('Usage: bun run scaffold <plc|plugin> <name>');
  const destination = join(projectRoot, kind === 'plc' ? 'equipment' : 'plugins', name);
  if (existsSync(destination)) throw new Error(`Already exists: ${destination}`);
  mkdirSync(destination, { recursive: true });
  if (kind === 'plugin') {
    writeFileSync(join(destination, 'index.ts'), `import { signal } from "@saturn/core";\nexport const enabled = signal("${name}.enabled", { initial: false });\n`);
  } else {
    writeFileSync(join(destination, 'device.ts'), `import { plc, signal } from "@saturn/core";\nexport const online = signal("${name}.online", { initial: false });\nexport const controller = plc("${name}", { label: "Контроллер", x:60, y:60, online });\n`);
    writeFileSync(join(destination, 'hmi.ts'), `import type { Hmi } from "@saturn/core";\nimport { controller } from "./device";\nexport default { width:320, height:240, equipment:[controller] } satisfies Hmi;\n`);
    writeFileSync(join(destination, 'compiler.ts'), `import type { FirmwareContext } from "@saturn/core";\n/** @ru Подключите реальный toolchain устройства. @en Configure the actual target toolchain. */\nexport default async function compile(context: FirmwareContext): Promise<void> {\n  // await context.run(["device-compiler", "firmware/main.c", "-o", context.outDir + "/firmware.bin"]);\n  throw new Error("Configure this PLC's real compiler before building firmware");\n}\n`);
    mkdirSync(join(destination, 'firmware'));
    writeFileSync(join(destination, 'firmware/README.md'), '# Firmware\n\nPut target sources and memory configuration here. Configure ../compiler.ts. No physical controller is implied by this scaffold.\n');
  }
  return destination;
}
export {createProject as create} from '../src/workspace/project-template';
import {createProject} from '../src/workspace/project-template';
if (import.meta.main) {
  try{
    const [kind,name,...options]=Bun.argv.slice(2);
    const usage='Usage: bun run scaffold project <directory> [--template empty|pumping-station|smart-home] [--example <project-directory>] | <plc|plugin> <name> [--project <directory>]';
    if(kind==='--help')console.log(usage);
    else{
      if(!kind||!name)throw new Error(usage);
      let created:string;
      if(kind==='project'){
        let template:'empty'|'pumping-station'|'smart-home'|undefined,example:string|undefined;
        while(options.length){const flag=options.shift(),value=options.shift();if(!value)throw new Error('Missing value for '+flag);if(flag==='--template'&&['empty','pumping-station','smart-home'].includes(value))template=value as typeof template;else if(flag==='--example')example=value;else throw new Error('Use --template empty|pumping-station|smart-home and optional --example <project-directory>');}
        created=createProject(name,{template,example});
      }else{
        if(options.length&&!(options.length===2&&options[0]==='--project'&&!!options[1]))throw new Error('Use --project <directory> for a PLC or plugin');
        created=scaffold(kind,name,options[1]);
      }
      console.log(created);
      console.log('Import generated definitions normally; nothing is registered globally.');
    }
  }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}

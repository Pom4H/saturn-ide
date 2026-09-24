import { existsSync, mkdirSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
export function scaffold(kind: string, name: string, projectRoot = resolve(Bun.env.SATURN_PROJECT ?? '../saturn-examples/pumping-station')) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw new Error('Use a lowercase name: plc-01');
  if (kind !== 'plc' && kind !== 'plugin') throw new Error('Usage: bun run scaffold <plc|plugin> <name>');
  const destination = join(projectRoot, kind === 'plc' ? 'equipment' : 'plugins', name);
  if (existsSync(destination)) throw new Error(`Already exists: ${destination}`);
  mkdirSync(destination, { recursive: true });
  if (kind === 'plugin') {
    writeFileSync(join(destination, 'index.ts'), `import { signal } from "@saturn/core";\nexport const enabled = signal("${name}.enabled", { initial: false });\n`);
  } else {
    writeFileSync(join(destination, 'device.ts'), `import { plc, signal } from "@saturn/core";\nexport const online = signal("${name}.online", { initial: false });\nexport const controller = plc("${name}", { label: {en:"Controller",ru:"Контроллер"}, x:60, y:60, online });\n`);
    writeFileSync(join(destination, 'hmi.ts'), `import type { Hmi } from "@saturn/core";\nimport { controller } from "./device";\nexport default { width:320, height:240, equipment:[controller] } satisfies Hmi;\n`);
    writeFileSync(join(destination, 'compiler.ts'), `import type { FirmwareContext } from "@saturn/core";\n/** @ru Подключите реальный toolchain устройства. @en Configure the actual target toolchain. */\nexport default async function compile(context: FirmwareContext): Promise<void> {\n  // await context.run(["vendor-compiler", "firmware/main.c", "-o", context.outDir + "/firmware.bin"]);\n  throw new Error("Configure this PLC's real compiler before building firmware");\n}\n`);
    mkdirSync(join(destination, 'firmware'));
    writeFileSync(join(destination, 'firmware/README.md'), '# Firmware\n\nPut target sources and memory configuration here. Configure ../compiler.ts. No physical controller is implied by this scaffold.\n');
  }
  return destination;
}
export function create(destination: string) {
  const target = resolve(destination), appRoot = resolve(import.meta.dir, '..');
  if (existsSync(target)) throw new Error('Destination already exists');
  // Copy project source, NOT the IDE source, scripts, tests or infrastructure.
  cpSync(resolve(Bun.env.SATURN_EXAMPLE ?? join(appRoot, '../saturn-examples/pumping-station')), target, { recursive: true, filter: path => !basename(path).startsWith('.') && basename(path) !== 'node_modules' });
  writeFileSync(join(target, 'package.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(target,'package.json'),'utf8')), name: basename(target), private: true }, null, 2) + '\n');
  writeFileSync(join(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'Preserve', moduleResolution: 'Bundler', noEmit: true, target:'ESNext',jsx:'react-jsx',skipLibCheck:true } }, null, 2) + '\n');
  writeFileSync(join(target, '.gitignore'), 'node_modules/\n.saturn/\n.env\n.env.*\n');
  return target;
}
if (import.meta.main) {
  const [kind, name] = Bun.argv.slice(2); if (!kind || !name) throw new Error('Usage: bun run scaffold <plc|plugin|project> <name>');
  console.log(kind === 'project' ? create(name) : scaffold(kind, name));
  console.log('Import generated definitions normally; nothing is registered globally.');
}

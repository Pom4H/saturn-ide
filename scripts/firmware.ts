import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FirmwareContext } from '../src/core';
import { execute } from '../src/workspace/git';
import { Workspace } from '../src/workspace/files';
export async function buildFirmware(projectRoot: string, devicePath: string) {
  if (!/^equipment\/[a-z][a-z0-9-]*$/.test(devicePath)) throw new Error('Expected equipment/<device-name>');
  const workspace = new Workspace(projectRoot), compiler = workspace.file(`${devicePath}/compiler.ts`);
  const outDir = resolve('.saturn/build', devicePath, crypto.randomUUID()); mkdirSync(outDir, { recursive: true });
  const module = await import(pathToFileURL(compiler).href);
  if (typeof module.default !== 'function') throw new Error('compiler.ts must export a build function');
  const context: FirmwareContext = { outDir, run: async argv => { if (!argv.length || !argv.every(a => typeof a === 'string')) throw new Error('Expected an argv array'); console.log(await execute(argv, dirname(compiler), 120000)); } };
  await (module.default as (context: FirmwareContext) => Promise<void>)(context); return outDir;
}
if (import.meta.main) { const device = Bun.argv[2]; if (!device) throw new Error('Usage: bun run firmware equipment/plc-01'); console.log(await buildFirmware(resolve(Bun.env.SATURN_PROJECT ?? 'project'), device)); }

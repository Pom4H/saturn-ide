import { ShellClient } from '../shell/client';
import { terminalIcon } from '../core/resources';
const client = new ShellClient(Bun.argv[2] ?? 'http://127.0.0.1:3000');
const catalog = await client.catalog();
for (const r of catalog.resources) console.log(`[${terminalIcon(r.icon)}] ${r.name.ru}\t${r.source?.path ?? ''}\t${r.uri}`);

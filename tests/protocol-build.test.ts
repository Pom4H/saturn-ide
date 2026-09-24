import { expect, test } from 'bun:test';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Builder } from '../src/workspace/build';
import { Workspace } from '../src/workspace/files';
import { Store } from '../src/runtime/store';
import { Runtime } from '../src/runtime/engine';
import { Events } from '../src/runtime/events';
import { ProjectInstallation } from '../src/runtime/project-installation';

/** Actual external workspace -> retained bundle -> SDK socket -> runtime -> SQLite. */
test('compiled Modbus project retains lazy SDK imports and executes through the real installation', async () => {
  const appRoot = resolve(import.meta.dir, '..'), dir = mkdtempSync(join(tmpdir(), 'saturn-sdk-build-'));
  const workspace = join(dir, 'project'), dataDir = join(dir, 'data'); mkdirSync(workspace);
  // Provision the test deployment explicitly, as an operator would install the locked SDKs.
  symlinkSync(join(appRoot, 'node_modules'), join(dir, 'node_modules'), 'junction');
  cpSync(join(appRoot, 'bun.lock'), join(workspace, 'bun.lock'));
  cpSync(join(appRoot, 'project/plugins/protocols'), join(workspace, 'plugins'), { recursive: true });
  let measured = 17, requests = 0;
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let pending: Buffer = Buffer.alloc(0);
    socket.on('data', data => {
      pending = Buffer.concat([pending, typeof data === 'string' ? Buffer.from(data) : data]);
      while (pending.length >= 12) {
        const length = pending.readUInt16BE(4) + 6; if (pending.length < length) break;
        const input = pending.subarray(0, length); pending = pending.subarray(length); requests++;
        const fn = input[7]; let response: Buffer;
        if (fn === 6) { measured = input.readUInt16BE(10); response = Buffer.from(input); }
        else {
          response = Buffer.alloc(11); input.copy(response, 0, 0, 7); response.writeUInt16BE(5, 4);
          response[7] = 3; response[8] = 2; response.writeUInt16BE(measured, 9);
        }
        socket.write(response);
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  writeFileSync(join(workspace, 'connections.ts'), `import {modbusTcp} from './plugins/modbus';export const source=modbusTcp('mb',{host:'127.0.0.1',port:${address.port}},{pollMs:20});`);
  writeFileSync(join(workspace, 'project.ts'), `import {project,signal} from '@saturn/core';import {source} from './connections';export default project({id:'p',label:'P',equipment:[],pipes:[],alarms:[],signals:{pressure:source.bind(signal('pressure',{initial:0,writable:true}),{unit:1,area:'holding',offset:0,format:'uint16'})}});`);
  writeFileSync(join(workspace, 'server.ts'), `import {acquire} from '@saturn/scada/acquisition';import {source} from './connections';export default acquire(source);`);
  const builder = new Builder(new Workspace(workspace), appRoot, dataDir), store = new Store(':memory:'), events = new Events();
  let installation: ProjectInstallation | undefined;
  try {
    const result = await builder.build(); expect(requests).toBe(0);
    expect(result.artifact.driver?.code).toContain('modbus-serial');
    expect(result.artifact.driver!.code.length).toBeLessThan(1000000);
    await store.init(); const runtime = new Runtime(result.project, store, events, () => {}); await runtime.init();
    installation = await ProjectInstallation.prepare(result.artifact, runtime, dataDir); expect(requests).toBe(0);
    await installation.start(); await installation.activate();
    const waitValue = async (value: number) => {
      const deadline = Date.now() + 10000;
      while (runtime.snapshot.samples.pressure?.value !== value || runtime.snapshot.samples.pressure?.quality !== 'good') {
        if (Date.now() > deadline) throw new Error('Compiled protocol failed to deliver an observation');
        await Bun.sleep(10);
      }
    };
    await waitValue(17); await installation.command('pressure', 21); await waitValue(21);
    expect((await store.history('pressure')).some(sample => sample.value === 21 && sample.quality === 'good')).toBe(true);
  } finally {
    try { await installation?.stop(); } finally {
      builder.close(); events.close(); await store.close();
      const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const socket of sockets) socket.destroy(); await closing;
      rmSync(dir, { recursive: true, force: true });
    }
  }
}, 30000);

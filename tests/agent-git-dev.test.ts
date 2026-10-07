import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/host/dev';
import type { GitState } from '../src/core/git';
import type { AgentEvent } from '../src/shell/agent-protocol';

async function* events(response: Response) {
  const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }); let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        yield JSON.parse(buffer.slice(0, end)) as AgentEvent; buffer = buffer.slice(end + 1);
      }
    }
  } finally { reader.releaseLock(); }
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'saturn-agent-git-')), projectDir = join(root, 'project');
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, 'project.ts'), `import {project} from '@saturn/core';
export default project({id:'agent-git',label:'Agent Git',signals:{},equipment:[],pipes:[]});`);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: projectDir });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Agent fixture'); git('config', 'user.email', 'fixture@example.test');
  git('add', 'project.ts'); git('commit', '-m', 'Initial model'); git('branch', 'task/existing');
  const app = await createApp({ projectDir, dataDir: join(root, 'data'), port: 0, preview: 'manual',
    agentCommand: [process.execPath, resolve('scripts/helpers/acp-fixture.ts')] });
  const key = app.state().key;
  const call = (path: string, body?: unknown) => fetch(new URL(path, app.server.url), {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'X-Saturn-Key': key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const state = async () => await (await call('/api/git')).json() as GitState;
  const change = async (action: 'create-task' | 'switch-task', message: string) => {
    const current = await state(); return call('/api/git', { action, message, expectedHead: current.head });
  };
  return { root, projectDir, app, call, state, change, git,
    close: async () => { await app.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('dev host excludes task switching and active ACP prompts, including permissions, in both directions', async () => {
  const f = await fixture();
  let release: string | undefined;
  let switching: Promise<Response> | undefined;
  try {
    expect(f.app.state().problems).toEqual([]);
    const connected = await f.call('/api/agent/connect', {}); expect(connected.status).toBe(200);
    const { id } = await connected.json() as { id: string };
    // An idle connection does not prevent a task from being created.
    const created = await f.change('create-task', 'Idle agent task'); expect(created.status).toBe(200);
    const createdState = await created.json() as GitState;
    expect(createdState.branch).toMatch(/^task\/idle-agent-task-/);

    const waiting = events(await f.call('/api/agent/prompt', { id, prompt: 'wait-fixture' }));
    expect((await waiting.next()).value?.kind).toBe('update');
    for (const [action, message] of [['create-task', 'Blocked'], ['switch-task', 'task/existing']] as const) {
      const denied = await f.change(action, message); expect(denied.status).toBe(409);
      expect(await denied.json()).toEqual({ error: 'Finish or stop the active agent request before changing tasks' });
    }
    expect((await f.state()).branch).toBe(createdState.branch);
    expect((await f.call('/api/agent/cancel', { id })).status).toBe(200);
    const cancelled: AgentEvent[] = []; for await (const event of waiting) cancelled.push(event);
    expect(cancelled.at(-1)).toEqual({ kind: 'stop', reason: 'cancelled' });
    expect((await f.change('switch-task', 'main')).status).toBe(200);

    const checking = events(await f.call('/api/agent/prompt', { id, prompt: 'inspect' }));
    let permission: Extract<AgentEvent, { kind: 'permission' }> | undefined;
    for (;;) { const event = (await checking.next()).value; if (!event) break; if (event.kind === 'permission') { permission = event; break; } }
    expect(permission).toBeDefined();
    expect((await f.change('switch-task', 'task/existing')).status).toBe(409);
    expect((await f.state()).branch).toBe('main');
    expect((await f.call('/api/agent/permission', { id, request: permission!.id, option: null })).status).toBe(200);
    const finished: AgentEvent[] = []; for await (const event of checking) finished.push(event);
    expect(finished.at(-1)).toEqual({ kind: 'stop', reason: 'end_turn' });

    // A real Git checkout hook holds the operation open while the reverse admission is tested.
    const entered = join(f.root, 'checkout-entered'); release = join(f.root, 'checkout-release');
    const hookScript = join(f.root, 'checkout-hook.ts');
    writeFileSync(hookScript, `import {existsSync,writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(entered)},'entered');
const deadline=Date.now()+10000;
while(!existsSync(${JSON.stringify(release)})){if(Date.now()>deadline)throw new Error('Checkout fixture timed out');await Bun.sleep(10);}`);
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(join(f.projectDir, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(hookScript)}\n`, { mode: 0o755 });
    switching = f.change('switch-task', 'task/existing');
    const deadline = Date.now() + 5000;
    while (!existsSync(entered) && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(entered)).toBe(true);
    const denied = await f.call('/api/agent/prompt', { id, prompt: 'inspect' });
    expect(denied.status).toBe(409);
    expect(await denied.json()).toEqual({ error: 'Git operation already running; wait before sending an agent request' });
    writeFileSync(release, 'released');
    expect((await switching).status).toBe(200);
    expect((await f.state()).branch).toBe('task/existing');
    // The rejected prompt did not create a hidden active request or close the idle connection.
    const after = events(await f.call('/api/agent/prompt', { id, prompt: 'wait-fixture' }));
    expect((await after.next()).value?.kind).toBe('update');
    expect((await f.call('/api/agent/cancel', { id })).status).toBe(200);
    for await (const _event of after) { /* drain the real ACP stop receipt */ }
  } finally {
    if (release) writeFileSync(release, 'released');
    await switching?.catch(() => {}); await f.close();
  }
}, 30_000);

test('failed checkout hooks preserve the Git error and reconcile the actual task and checked source', async () => {
  const f = await fixture();
  try {
    const initial = await f.state();
    // Different commits with identical files cannot rely on a source-file watcher.
    f.git('switch', 'task/existing'); f.git('commit', '--allow-empty', '-m', 'A different task commit');
    const destination = f.git('rev-parse', 'HEAD'); f.git('switch', 'main');
    const release = async () => await (await f.call('/api/releases')).json() as {
      checked: string; applied: string | null; published: string | null; source: { sourceRevision: string };
    };
    const before = await release(); expect(before.source.sourceRevision).toBe(initial.head);
    writeFileSync(join(f.projectDir, '.git', 'hooks', 'post-checkout'),
      "#!/bin/sh\nprintf 'post-checkout fixture failure\\n' >&2\nexit 1\n", { mode: 0o755 });

    const switched = await f.change('switch-task', 'task/existing');
    expect(switched.status).toBe(400);
    expect((await switched.json() as { error: string }).error).toContain('post-checkout fixture failure');
    const actual = await f.state(); expect(actual.branch).toBe('task/existing'); expect(actual.head).toBe(destination);
    const reconciled = await release();
    expect(reconciled.source.sourceRevision).toBe(destination);
    expect(reconciled.checked).not.toBe(before.checked);
    expect(reconciled.applied).toBeNull(); expect(reconciled.published).toBeNull();

    const created = await f.change('create-task', 'Проверка +Т ADCT после hook');
    expect(created.status).toBe(400);
    expect((await created.json() as { error: string }).error).toContain('post-checkout fixture failure');
    const createdState = await f.state();
    expect(createdState.branch).toMatch(/^task\/проверка-т-adct-после-hook-/);
    expect(createdState.head).toBe(destination);
    expect(createdState.branches?.find(branch => branch.current)?.title).toBe('Проверка +Т ADCT после hook');
    expect((await release()).source.sourceRevision).toBe(destination);
    expect(f.git('rev-list', '--count', 'HEAD')).toBe('2');
    expect(f.git('rev-parse', 'main')).toBe(initial.head);
    expect(f.git('status', '--porcelain')).toBe('');
  } finally { await f.close(); }
}, 20_000);

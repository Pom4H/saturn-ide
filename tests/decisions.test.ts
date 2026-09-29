import { expect, test } from 'bun:test';
import { project, pump, signal } from '../src/core';
import type { IDEState } from '../src/protocol';
import { resourceUri } from '../src/core/resources';
import { readDecisionRequest, type DecisionRequest } from '../src/core/decision';
import { ShellSession } from '../src/shell/model/session';
import { CommandShell } from '../src/shell/model/commands/engine';

function reply(request: DecisionRequest, label: string) {
  const choices = request.questions.next.criteria;
  const id = Object.entries(choices).find(([, description]) => description.startsWith(label + ':'))?.[0] ?? 'none';
  return { model: 'contract-test', answers: { next: { type: 'choice', choice: id, confidence: 1, probabilities: Object.fromEntries(Object.keys(choices).map(key => [key, key === id ? 1 : 0])) } } };
}
function setup(labels: string[] = [], decide?: (request: DecisionRequest, signal?: AbortSignal) => Promise<unknown>) {
  const motor = pump('P-01', { x: 0, y: 0, label: { ru: 'Насос', en: 'Pump' } });
  const speed = signal('speed', { initial: 0, min: 0, max: 50, writable: true, unit: 'Hz' });
  const model = project({ id: 'test', label: 'Test', equipment: [motor], signals: { speed }, pipes: [], alarms: [] });
  const state: IDEState = { project: model, revision: 'a'.repeat(64), mode: 'simulation', runtimePhase: 'running', snapshot: { samples: {}, alarms: {} }, positions: {}, problems: [], adapter: 'sqlite', key: 'never-send-session-key', pushPublicKey: '' };
  for (const definition of Object.values(model.signals)) state.snapshot.samples[definition.id] = { signal: definition.id, value: definition.initial, quality: 'good', at: Date.now() };
  const path = 'project.ts', uri = resourceUri(model.id, 'device', motor.id);
  let online = true, writes = 0;
  const session = new ShellSession('browser', { read: async () => ({ path, source: 'const privateSource = 1;\n', version: '1' }), save: async file => { writes++; return { ...file, version: String(writes + 1) }; } });
  session.replaceCatalog({ project: model.id, revision: 'catalog-1', resources: [{ uri, kind: 'device', icon: 'pump', entityId: motor.id, name: { ru: 'Насос', en: 'Pump' }, source: { path, from: 0, to: 10 }, editors: ['diagram', 'source', 'signals'], related: [] }] });
  session.selectEquipment(motor.id);
  const calls: { path: string; body: unknown }[] = [], requests: DecisionRequest[] = [];
  const commands = new CommandShell({ session, state: () => state, connected: () => online,
    request: async <T>(endpoint: string, body?: unknown, abort?: AbortSignal): Promise<T> => {
      if (endpoint === 'decision/evaluate') {
        const request = readDecisionRequest(body); requests.push(request);
        return (decide ? await decide(request, abort) : reply(request, labels.shift() ?? 'none')) as T;
      }
      calls.push({ path: endpoint, body });
      return (endpoint === 'language' ? [] : { accepted: true }) as T;
    },
  });
  return { commands, session, state, calls, requests, uri, path, writes: () => writes, offline: () => { online = false; } };
}

test('decisions select existing commands and open source in the SAME browser session only after confirmation', async () => {
  const f = setup(['project open', 'P-01', 'source']), d = f.commands.decisions;
  try {
    d.setInput('Покажи выбранный насос в коде'); await d.prepare();
    expect(d.getSnapshot().phase).toBe('ready');
    const plan = d.getSnapshot().plan!;
    expect(plan.command).toBe('/project open P-01 source'); expect(f.session.getSnapshot().surface).toBe('diagram'); expect(f.calls).toHaveLength(0);
    const payload = JSON.stringify(f.requests);
    expect(payload).not.toContain('never-send-session-key'); expect(payload).not.toContain('privateSource');
    await d.confirm(plan.id);
    expect(d.getSnapshot().phase).toBe('done'); expect(f.session.getSnapshot().surface).toBe('source'); expect(f.session.getSnapshot().selected).toBe('P-01');
    expect(f.commands.getSnapshot().entries).toHaveLength(1);
  } finally { f.commands.dispose(); }
});

test('numeric values use exact user literals, commands are single-use and acceptance does not fabricate readback', async () => {
  const f = setup(['runtime set', 'speed', '30.5']), d = f.commands.decisions;
  try {
    d.setInput('Установи speed 30,5 Hz'); await d.prepare();
    const plan = d.getSnapshot().plan!; expect(plan.command).toBe('/runtime set speed 30.5'); expect(f.calls).toHaveLength(0);
    await Promise.all([d.confirm(plan.id), d.confirm(plan.id)]);
    expect(f.calls).toEqual([{ path: 'command', body: { signal: 'speed', value: 30.5, expectedApplied: 'sha256:' + f.state.revision } }]);
    expect(f.state.snapshot.samples.speed?.value).toBe(0);
    await d.confirm(plan.id); expect(f.calls).toHaveLength(1);
  } finally { f.commands.dispose(); }
});

test('ambiguous decision asks the human and missing numeric values cannot use defaults or hallucinations', async () => {
  const f = setup(['runtime set', 'speed']), d = f.commands.decisions;
  try {
    d.setInput('Измени speed'); await d.prepare();
    expect(d.getSnapshot().phase).toBe('clarify'); expect(d.getSnapshot().argument?.kind).toBe('value'); expect(d.getSnapshot().options).toHaveLength(0);
    await d.provide('100'); expect(d.getSnapshot().phase).toBe('clarify'); expect(f.calls).toHaveLength(0);
    await d.provide('35'); expect(d.getSnapshot().plan?.command).toBe('/runtime set speed 35');
    d.cancel(); expect(d.getSnapshot().plan).toBeUndefined(); expect(f.calls).toHaveLength(0);
  } finally { f.commands.dispose(); }
  const ambiguous = setup(), a = ambiguous.commands.decisions;
  try {
    a.setInput('Сделай что-нибудь'); await a.prepare(); expect(a.getSnapshot().phase).toBe('clarify'); expect(a.getSnapshot().options.length).toBeGreaterThan(0);
    expect(a.getSnapshot().options.some(item => item.value === 'source insert')).toBe(false);
    await a.choose(a.getSnapshot().options.find(item => item.value === 'project context')!.id);
    expect(a.getSnapshot().plan?.command).toBe('/project context'); expect(ambiguous.calls).toHaveLength(0);
  } finally { ambiguous.commands.dispose(); }
});

test('selection, source, revision and connectivity changes invalidate a prepared action', async () => {
  for (const change of ['selection', 'source', 'revision', 'offline']) {
    const f = setup(['runtime set', 'P-01.run', 'false']), d = f.commands.decisions;
    try {
      await f.session.documents.open(f.path);
      d.setInput('Останови насос'); await d.prepare(); const plan = d.getSnapshot().plan!; expect(plan).toBeDefined();
      if (change === 'selection') f.session.selectEquipment('other');
      if (change === 'source') f.session.documents.edit(f.path, 'new user draft');
      if (change === 'revision') f.state.revision = 'b'.repeat(64);
      if (change === 'offline') f.offline();
      await d.confirm(plan.id); expect(f.calls).toHaveLength(0); expect(d.getSnapshot().phase).toBe('error');
    } finally { f.commands.dispose(); }
  }
});

test('a late model response cannot replace revised input, and cancelling inference never runs an action', async () => {
  let release: (value: unknown) => void = () => {};
  let captured: DecisionRequest | undefined, aborted = false;
  const f = setup([], async (request, abort) => {
    captured = request; abort?.addEventListener('abort', () => { aborted = true; }, { once: true });
    return await new Promise(resolve => { release = resolve; });
  }), d = f.commands.decisions;
  try {
    d.setInput('Открой насос'); const pending = d.prepare();
    expect(captured).toBeDefined();
    d.setInput('Не надо'); release(reply(captured!, 'project context')); await pending;
    expect(aborted).toBe(true); expect(d.getSnapshot().input).toBe('Не надо'); expect(d.getSnapshot().phase).toBe('idle'); expect(f.calls).toHaveLength(0);
  } finally { f.commands.dispose(); }
});

test('a draft edited while confirm awaits open is not saved under an old proposal', async () => {
  const f = setup(['source save', 'project.ts']), d = f.commands.decisions;
  try {
    await f.session.documents.open(f.path); f.session.documents.edit(f.path, 'approved draft');
    d.setInput('Сохрани файл'); await d.prepare(); const plan = d.getSnapshot().plan!;
    const confirmed = d.confirm(plan.id);
    f.session.documents.edit(f.path, 'newer unapproved draft');
    await confirmed; expect(f.writes()).toBe(0); expect(f.session.documents.getSnapshot().get(f.path)?.draft).toBe('newer unapproved draft'); expect(d.getSnapshot().phase).toBe('error');
  } finally { f.commands.dispose(); }
});

test('expired proposals and stale observations block controls without retry', async () => {
  const f = setup(['runtime set', 'P-01.run', 'false']), d = f.commands.decisions;
  try {
    d.setInput('Останови насос'); await d.prepare(); const plan = d.getSnapshot().plan!;
    f.state.snapshot.samples['P-01.run'] = { ...f.state.snapshot.samples['P-01.run']!, quality: 'stale' };
    await d.confirm(plan.id); expect(f.calls).toHaveLength(0); expect(d.getSnapshot().message).toContain('command not sent');
  } finally { f.commands.dispose(); }
  const expired = setup(['project context']), e = expired.commands.decisions;
  const now = Date.now;
  try {
    e.setInput('Покажи контекст'); await e.prepare(); const plan = e.getSnapshot().plan!;
    Date.now = () => plan.expiresAt + 1; await e.confirm(plan.id);
    expect(e.getSnapshot().phase).toBe('error'); expect(expired.commands.getSnapshot().entries).toHaveLength(0);
  } finally { Date.now = now; expired.commands.dispose(); }
});

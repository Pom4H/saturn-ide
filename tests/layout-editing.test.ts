import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Documents, type SourceFile } from '../src/shell/model/documents';
import { LayoutEditing } from '../src/shell/model/layout-editing';
import type { PositionSource } from '../src/source-edits';

const source = 'const p = pump("p", { x: 1, y: 2 });\nconst q = pump("q", { x: 3, y: 4 });\n';
function position(text: string, id: string, path = 'equipment.ts'): PositionSource {
  const start = text.indexOf(`"${id}"`);
  const range = (key: string) => {
    const from = text.indexOf(`${key}: `, start) + 3;
    const literal = /^-?\d+/.exec(text.slice(from))![0];
    return { from, to: from + literal.length };
  };
  return { path, version: 'v0', x: range('x'), y: range('y') };
}
async function fixture() {
  const pending: { file: SourceFile; resolve(file: SourceFile): void; reject(error: Error): void }[] = [];
  let version = 0;
  const documents = new Documents({
    read: async path => ({ path, source, version: 'v0' }),
    save: file => new Promise((resolve, reject) => pending.push({ file, resolve, reject })),
  });
  await documents.open('equipment.ts');
  const edits = new LayoutEditing(documents);
  const positions = { p: position(source, 'p'), q: position(source, 'q') };
  const complete = (index: number) => {
    const write = pending[index]!;
    write.resolve({ ...write.file, version: `v${++version}` });
  };
  return { documents, edits, positions, pending, complete };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

test('two completed gestures remap ranges and serialize versioned writes', async () => {
  const f = await fixture();
  assert.equal(f.edits.begin('p', f.positions), true);
  f.edits.move('p', 12345, -200);
  const first = f.edits.end(false);
  assert.equal(f.edits.begin('q', f.positions), true);
  f.edits.move('q', -300, 4444);
  const second = f.edits.end(false);
  assert.equal(f.pending.length, 1);
  f.complete(0);
  await turn();
  assert.equal(f.pending.length, 2);
  assert.equal(f.pending[1]!.file.version, 'v1');
  assert.equal(f.pending[1]!.file.source, 'const p = pump("p", { x: 12345, y: -200 });\nconst q = pump("q", { x: -300, y: 4444 });\n');
  f.complete(1);
  await Promise.all([first, second]);
  assert.equal(f.documents.dirty, false);
});

test('a response cannot persist the middle of an active gesture', async () => {
  const f = await fixture();
  f.edits.begin('p', f.positions); f.edits.move('p', 10, 20);
  const first = f.edits.end(false);
  f.edits.begin('q', f.positions); f.edits.move('q', 30, 40);
  f.complete(0); await first;
  assert.equal(f.pending.length, 1);
  f.edits.move('q', 300, 400);
  const second = f.edits.end(false);
  assert.equal(f.pending.length, 2);
  assert.match(f.pending[1]!.file.source, /x: 300, y: 400/);
  f.complete(1); await second;
});

test('cancel restores the prior completed gesture while its save is pending', async () => {
  const f = await fixture();
  f.edits.begin('p', f.positions); f.edits.move('p', 10, 20);
  const first = f.edits.end(false);
  f.edits.begin('p', f.positions); f.edits.move('p', 999, 888);
  const cancelled = f.edits.end(true);
  assert.deepEqual(f.edits.getSnapshot().previews.p, { id: 'p', x: 10, y: 20 });
  assert.equal(f.documents.getSnapshot().get('equipment.ts')!.draft, f.pending[0]!.file.source);
  f.complete(0); await Promise.all([first, cancelled]);
  assert.equal(f.pending.length, 1);
});

test('cancel of a first gesture does not save and restores the exact text', async () => {
  const f = await fixture();
  f.edits.begin('p', f.positions); f.edits.move('p', 99, 88);
  await f.edits.end(true);
  assert.deepEqual(f.edits.getSnapshot(), { previews: {}, dragging: false });
  assert.equal(f.documents.getSnapshot().get('equipment.ts')!.draft, source);
  assert.equal(f.pending.length, 0);
});

test('late save completion never auto-saves unrelated editor keystrokes', async () => {
  const f = await fixture();
  f.edits.begin('p', f.positions); f.edits.move('p', 10, 20);
  const saved = f.edits.end(false);
  f.documents.edit('equipment.ts', f.documents.getSnapshot().get('equipment.ts')!.draft + '// still typing\n');
  f.complete(0); await saved;
  assert.equal(f.pending.length, 1);
  assert.equal(f.documents.dirty, true);
  assert.match(f.documents.getSnapshot().get('equipment.ts')!.draft, /still typing/);
  assert.equal(f.edits.begin('p', f.positions), false);
});

test('stale telemetry cannot remove the latest preview', async () => {
  const f = await fixture();
  f.edits.begin('p', f.positions); f.edits.move('p', 10, 20);
  const saved = f.edits.end(false);
  f.edits.reconcile([{ id: 'p', x: 10, y: 20 }]);
  assert.ok(f.edits.getSnapshot().previews.p);
  f.complete(0); await saved;
  f.edits.reconcile([{ id: 'p', x: 1, y: 2 }]);
  assert.ok(f.edits.getSnapshot().previews.p);
  f.edits.reconcile([{ id: 'p', x: 10, y: 20 }]);
  assert.equal(f.edits.getSnapshot().previews.p, undefined);
});

test('failed writes retain the draft and block further gestures until resolved', async () => {
  const f = await fixture();
  f.edits.begin('p', f.positions); f.edits.move('p', 10, 20);
  const saved = f.edits.end(false);
  const rejected = assert.rejects(saved, /conflict/);
  f.pending[0]!.reject(new Error('conflict'));
  await rejected;
  assert.equal(f.documents.dirty, true);
  assert.match(f.documents.getSnapshot().get('equipment.ts')!.error!, /conflict/);
  assert.equal(f.edits.begin('p', f.positions), false);
  assert.ok(f.edits.getSnapshot().previews.p);
});

test('preview rounding matches the authored numeric literals', async () => {
  const f = await fixture();
  f.edits.begin('p', f.positions); f.edits.move('p', 10.4, -20.7);
  assert.deepEqual(f.edits.getSnapshot().previews.p, { id: 'p', x: 10, y: -21 });
  assert.match(f.documents.getSnapshot().get('equipment.ts')!.draft, /x: 10, y: -21/);
  await f.edits.end(true);
});

test('missing, stale and dirty positions cannot start a gesture', async () => {
  const f = await fixture();
  assert.equal(f.edits.begin('missing', f.positions), false);
  assert.equal(f.edits.begin('p', { p: { ...f.positions.p, version: 'stale' } }), false);
  f.documents.edit('equipment.ts', source + '// manual\n');
  assert.equal(f.edits.begin('p', f.positions), false);
  assert.deepEqual(f.edits.getSnapshot(), { previews: {}, dragging: false });
});

test('one active gesture cannot be replaced or move another equipment ID', async () => {
  const f = await fixture();
  assert.equal(f.edits.begin('p', f.positions), true);
  assert.equal(f.edits.begin('q', f.positions), false);
  f.edits.move('q', 300, 400);
  assert.equal(f.documents.getSnapshot().get('equipment.ts')!.draft, source);
  assert.throws(() => f.edits.move('p', Infinity, 0), /Invalid coordinates/);
  await f.edits.end(true);
});

test('different files keep independent ranges and save queues', async () => {
  const f = await fixture();
  await f.documents.open('second.ts');
  const positions = { ...f.positions, other: position(source, 'q', 'second.ts') };
  f.edits.begin('p', positions); f.edits.move('p', 12345, -200);
  const first = f.edits.end(false);
  assert.equal(f.edits.begin('other', positions), true);
  f.edits.move('other', 99, 88);
  const second = f.edits.end(false);
  assert.equal(f.pending.length, 2);
  assert.equal(f.pending[1]!.file.path, 'second.ts');
  assert.equal(f.pending[1]!.file.source, source.replace('x: 3, y: 4', 'x: 99, y: 88'));
  f.complete(0); f.complete(1);
  await Promise.all([first, second]);
});

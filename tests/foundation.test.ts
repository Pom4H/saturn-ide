import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, createArtifact, digest, verifyArtifact, type BuildArtifact } from '../src/core/artifact';
import { InstallationManager, type Installation } from '../src/runtime/installation';
const artifact = async (id: string) => createArtifact({ id, signals: {} }, `export default ${JSON.stringify(id)}`, { sourceRevision: null, sourceDigest: await digest(id), coreHash: await digest('core'), lockHash: null, bunVersion: 'test' });

test('artifact survives transport; source/build/driver identities are separate', async () => {
  const a = await artifact('a'); const b = await verifyArtifact(JSON.parse(JSON.stringify(a)));
  assert.equal(b.hash, a.hash); assert.notEqual(a.hash, a.provenance.sourceDigest);
  assert.notEqual(a.hash, a.driver?.hash); assert.ok(Object.isFrozen(b)); assert.ok(Object.isFrozen(b.provenance));
});
test('canonical hashing ignores object insertion order and rejects executable/cyclic data', async () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  for (const input of [{ x: () => 1 }, { x: NaN }, new Date(), [undefined]]) assert.throws(() => canonical(input));
  const cycle: { self?: unknown } = {}; cycle.self = cycle; assert.throws(() => canonical(cycle));
});
test('tampered model, driver and provenance are rejected', async () => {
  const a = await artifact('a');
  await assert.rejects(verifyArtifact({ ...a, model: '{"id":"b"}' }), /hash/);
  await assert.rejects(verifyArtifact({ ...a, driver: { ...a.driver, code: 'changed' } }), /hash/);
  await assert.rejects(verifyArtifact({ ...a, provenance: { ...a.provenance, coreHash: await digest('other') } }), /hash/);
});
function harness() {
  const events: string[] = [];
  let durable: string | null = null;
  const failure = { prepare: '', start: '', stop: '', activate: '', persist: false };
  const manager = new InstallationManager({
    prepare: async a => {
      const id = (JSON.parse(a.model) as { id: string }).id;
      events.push(`prepare:${id}`);
      if (failure.prepare === id) throw new Error('prepare failed');
      return { artifact: a, start: async () => { events.push(`start:${id}`); if (failure.start === id) throw new Error('start failed'); }, stop: async () => { events.push(`stop:${id}`); if (failure.stop === id) throw new Error('stop failed'); }, activate: async () => { events.push(`active:${id}`); if (failure.activate === id) throw new Error('activation failed'); } } satisfies Installation;
    },
    persist: async (next, expected) => { events.push('persist'); assert.equal(durable, expected); if (failure.persist) throw new Error('storage failed'); durable = next; },
  });
  return { manager, events, failure, durable: () => durable };
}
test('candidate validates before the working driver is stopped', async () => {
  const h = harness(), a = await artifact('a'), b = await artifact('b');
  await h.manager.apply(a, null); h.events.length = 0; h.failure.prepare = 'b';
  await assert.rejects(h.manager.apply(b, a.hash), /prepare/);
  assert.deepEqual(h.events, ['prepare:b']); assert.equal(h.manager.applied, a.hash); assert.equal(h.manager.phase, 'running');
});
test('failed start restores previous installation without advancing durable revision', async () => {
  const h = harness(), a = await artifact('a'), b = await artifact('b');
  await h.manager.apply(a, null); h.events.length = 0; h.failure.start = 'b';
  await assert.rejects(h.manager.apply(b, a.hash), /start failed/);
  assert.deepEqual(h.events, ['prepare:b', 'stop:a', 'start:b', 'stop:b', 'start:a', 'active:a']);
  assert.equal(h.manager.phase, 'running'); assert.equal(h.manager.applied, a.hash); assert.equal(h.durable(), a.hash);
});
test('failed persistence stops candidate and restores previous installation', async () => {
  const h = harness(), a = await artifact('a'), b = await artifact('b');
  await h.manager.apply(a, null); h.failure.persist = true;
  await assert.rejects(h.manager.apply(b, a.hash), /storage/); assert.equal(h.manager.applied, a.hash); assert.equal(h.durable(), a.hash);
});
test('ambiguous stop/cleanup failure is fail-closed, never starts a second hardware owner', async () => {
  const h = harness(), a = await artifact('a'), b = await artifact('b'); await h.manager.apply(a, null);
  h.events.length = 0; h.failure.stop = 'a';
  await assert.rejects(h.manager.apply(b, a.hash), /did not stop/); assert.ok(!h.events.includes('start:b')); assert.equal(h.manager.phase, 'faulted');
});
test('activation failure after commit reports the new applied build, not a fake rollback', async () => {
  const h = harness(), a = await artifact('a'); h.failure.activate = 'a';
  await assert.rejects(h.manager.apply(a, null), /applied/); assert.equal(h.manager.applied, a.hash); assert.equal(h.durable(), a.hash); assert.equal(h.manager.phase, 'faulted');
});
test('concurrent stale apply requests cannot replace the winner', async () => {
  const h = harness(), a = await artifact('a'), b = await artifact('b');
  const results = await Promise.allSettled([h.manager.apply(a, null), h.manager.apply(b, null)]);
  assert.equal(results[0]?.status, 'fulfilled'); assert.equal(results[1]?.status, 'rejected'); assert.equal(h.manager.applied, a.hash);
});
test('close drains and prevents later starts', async () => {
  const h = harness(), a = await artifact('a'); await h.manager.apply(a, null); await h.manager.close();
  assert.equal(h.manager.phase, 'closed'); await assert.rejects(h.manager.apply(a, a.hash), /closing/);
});
test('restore uses the retained applied build without republishing', async () => {
  const h = harness(), a = await artifact('restored'); h.failure.persist = true;
  await h.manager.restore(a); assert.equal(h.manager.applied, a.hash); assert.equal(h.manager.phase, 'running');
  assert.ok(!h.events.includes('persist')); await assert.rejects(h.manager.restore(a), /empty/);
});
test('compatible layout adoption preserves the acquisition session', async () => {
  const events: string[] = []; const a = await artifact('a'), b = await artifact('b');
  const manager = new InstallationManager({
    prepare: async artifact => ({ artifact, acquisitionKey: 'unchanged driver and physical configuration',
      start: async () => { events.push('start'); }, stop: async () => { events.push('stop'); },
      activate: async () => { events.push('activate'); }, adopt: async () => { events.push('adopt'); },
    }),
    persist: async () => { events.push('persist'); },
  });
  await manager.apply(a, null); events.length = 0; await manager.apply(b, a.hash);
  assert.deepEqual(events, ['persist', 'adopt']); assert.equal(manager.applied, b.hash);
});

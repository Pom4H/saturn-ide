import { expect, test } from 'bun:test';
import { Store } from '../src/runtime/store';
import { RevisionStore } from '../src/runtime/revisions';
import { createArtifact, digest } from '../src/core/artifact';
import { decodeProject } from '../src/runtime/decode-project';
import demo from '../project/project';
test('actual SQLite stores builds, separates published/applied, and compare-and-swaps',async()=>{
  const store=new Store(':memory:');await store.init();const revisions=new RevisionStore(store.sql);await revisions.init();
  try {
    const provenance={sourceRevision:null,sourceDigest:await digest('source'),coreHash:await digest('core'),lockHash:null,bunVersion:Bun.version};
    const a=await createArtifact(demo,null,provenance),b=await createArtifact({...demo,label:'Another build'},null,provenance);
    await revisions.put(a);await revisions.put(b);expect((await revisions.state()).applied).toBeNull();
    await revisions.publish(a.hash,null);expect((await revisions.state()).applied).toBeNull();await revisions.apply(a.hash,null);
    await expect(revisions.publish(b.hash,null)).rejects.toThrow('changed');await revisions.publish(b.hash,a.hash);
    await expect(revisions.apply(b.hash,null)).rejects.toThrow('changed');expect((await revisions.state()).applied).toBe(a.hash);
    await revisions.apply(b.hash,a.hash);const restored=new RevisionStore(store.sql);expect((await restored.state()).applied).toBe(b.hash);
    const model=decodeProject((await restored.get(b.hash)).model);expect(model.equipment).toHaveLength(4);expect(model.pipes[0]?.flow).toBe(model.signals.flow);
  } finally {await store.close();}
});

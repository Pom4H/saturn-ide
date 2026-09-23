import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { Store } from '../src/runtime/store';
import { fixture } from './helpers';
for(const adapter of ['sqlite','postgres'] as const){const run=adapter==='postgres'&&!Bun.env.TEST_POSTGRES_URL?test.skip:test;
  run(`${adapter}: native storage restart, ordered history and retention`,async()=>{
    const f=fixture(),url=adapter==='postgres'?Bun.env.TEST_POSTGRES_URL!:`sqlite://${join(f.dir,'test.sqlite')}`;let store=new Store(url);
    try{await store.init();const id=`test-${crypto.randomUUID()}`;await store.append([{signal:id,value:12,quality:'good',at:100},{signal:id,value:15,quality:'good',at:200}]);
      expect((await store.history(id)).map(s=>s.value)).toEqual([12,15]);await store.close();store=new Store(url);await store.init();expect((await store.latest()).find(s=>s.signal===id)?.value).toBe(15);
      await store.prune(150);expect((await store.history(id)).map(s=>s.value)).toEqual([15]);
    }finally{await store.close();f.clean();}
  },30000);
}

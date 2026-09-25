import {test,expect} from 'bun:test';
test('CI cannot silently omit the supported PostgreSQL backend',()=>{if(Bun.env.CI)expect(Bun.env.TEST_POSTGRES_URL).toMatch(/^postgres/);});

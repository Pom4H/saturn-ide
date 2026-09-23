import { expect, test } from 'bun:test';
import { Store } from '../src/server/store';
import { reportResponse } from '../src/server/report-api';
import { column, project, report, signal } from '../src/core';
import type { ReportResult } from '../src/reports';
for(const backend of ['sqlite','postgres'] as const){
  const run=backend==='postgres'&&!Bun.env.TEST_POSTGRES_URL?test.skip:test;
  run(`${backend}: reports read beyond chart limits, preserve gaps and export CSV`,async()=>{
    const store=new Store(backend==='sqlite'?':memory:':Bun.env.TEST_POSTGRES_URL!);await store.init();
    try{
      const id=`flow-${crypto.randomUUID()}`,flow=signal(id,{initial:0,unit:'m³/h',staleAfter:1000});
      const p=project({id:'station',label:'Station',signals:{flow},equipment:[],pipes:[],alarms:[],reports:[report('hour',{label:'Volume',bucketMs:1000,columns:{volume:column(flow,'integral','Volume','m³')}})]});
      const from=Date.now()-500000,to=from+400000;
      await store.append(Array.from({length:400},(_,i)=>({signal:id,at:from+i*1000,value:36,quality:'good' as const})));
      const response=await reportResponse(store,p,'revision-1',new URL(`http://localhost/api/report?id=hour&from=${from}&to=${to}`));
      const result=await response.json() as ReportResult;
      expect(result.rows).toHaveLength(400);expect(result.revision).toBe('revision-1');
      expect(result.rows.reduce((total,row)=>total+Number(row.values.volume),0)).toBeCloseTo(4,8);
      expect(result.rows[0]?.coverage.volume).toBe(1);
      const csv=await reportResponse(store,p,'revision-1',new URL(`http://localhost/api/report?id=hour&from=${from}&to=${to}&format=csv&locale=en`));
      expect(csv.headers.get('Content-Type')).toContain('text/csv');expect((await csv.text()).split('\r\n')).toHaveLength(401);
      await expect(reportResponse(store,p,'r',new URL('http://localhost/api/report?id=missing'))).rejects.toThrow('Unknown report');
    }finally{await store.close();}
  },30000);
}

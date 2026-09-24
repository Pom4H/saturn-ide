import { expect, test } from 'bun:test';
import { Store } from '../src/runtime/store';
import { reportResponse } from '../src/host/report-api';
import { column, project, report, signal } from '../src/core';
import type { ReportResult } from '../src/reports';
for(const backend of ['sqlite','postgres'] as const){const run=backend==='postgres'&&!Bun.env.TEST_POSTGRES_URL?test.skip:test;
  run(`${backend}: reports exceed chart limits, preserve coverage and export CSV`,async()=>{
    const store=new Store(backend==='sqlite'?':memory:':Bun.env.TEST_POSTGRES_URL!);await store.init();try{
      const id=`flow-${crypto.randomUUID()}`,flow=signal(id,{initial:0,unit:'m³/h',staleAfter:1000});const p=project({id:'station',label:'Station',signals:{flow},equipment:[],pipes:[],alarms:[],reports:[report('hour',{label:'Volume',bucketMs:1000,columns:{volume:column(flow,'integral','Volume','m³')}})]});
      const from=Date.now()-500000,to=from+400000;await store.append(Array.from({length:400},(_,i)=>({signal:id,at:from+i*1000,value:36,quality:'good' as const})));
      const response=await reportResponse(store,p,'revision-1',new URL(`http://localhost/api/report?id=hour&from=${from}&to=${to}`)),result=await response.json() as ReportResult;
      expect(result.rows).toHaveLength(400);expect(result.revision).toBe('revision-1');expect(result.rows.reduce((total,row)=>total+Number(row.values.volume),0)).toBeCloseTo(4,8);expect(result.rows[0]?.coverage.volume).toBe(1);
      const csv=await reportResponse(store,p,'revision-1',new URL(`http://localhost/api/report?id=hour&from=${from}&to=${to}&format=csv&locale=en`));expect(csv.headers.get('Content-Type')).toContain('text/csv');expect((await csv.text()).split('\r\n')).toHaveLength(401);
      await expect(reportResponse(store,p,'r',new URL('http://localhost/api/report?id=missing'))).rejects.toThrow('Unknown report');
      const stable='signal:station:flow',old=signal('station.flow',{initial:0,unit:'m³/h',staleAfter:1000,semanticId:stable});
      const renamed=signal('station-main.flow',{initial:0,unit:'m³/h',staleAfter:1000,semanticId:stable});
      await store.append([{signal:old.id,semantic:stable,at:from,value:10,quality:'good'}]);
      const renamedProject=project({id:'renamed',label:'Renamed',signals:{flow:renamed},equipment:[],pipes:[],alarms:[],reports:[report('renamed-hour',{label:'Volume',bucketMs:1000,columns:{mean:column(renamed,'mean','Mean','m³/h')}})]});
      const renamedResponse=await reportResponse(store,renamedProject,'revision-2',new URL(`http://localhost/api/report?id=renamed-hour&from=${from}&to=${from+1000}`));
      const renamedResult=await renamedResponse.json() as ReportResult;expect(renamedResult.rows[0]?.values.mean).toBe(10);
    }finally{await store.close();}
  },30000);
}

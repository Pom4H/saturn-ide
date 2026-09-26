import {Database} from 'bun:sqlite';
import type {QueryReportResult} from '../core/report-output';
import type {QueryReport} from '../core/reporting';
import type {Value} from '../core';
export interface ReportCapsule {samples:{signal:string;time:number;value:Value|null;quality:string}[];segments:{signal:string;start:number;end:number;value:Value|null;quality:string}[]}
export interface QueryTask {definition:QueryReport;data:ReportCapsule;from:number;to:number;revision:string;inputs:Record<string,number>}
/** Native SQL executes in a disposable process containing only the captured dataset. */
export function executeQuery(task:QueryTask):QueryReportResult{
  const db=new Database(':memory:');try{
    const sql=task.definition.sql.trim().replace(/;\s*$/,'');
    const syntax=sql.replace(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]/g,' ');
    if(!/^\s*SELECT\b/i.test(syntax)||syntax.includes(';')||/\b(attach|detach|pragma|insert|delete|update|create|drop|alter|vacuum|replace|recursive|load_extension|readfile|writefile|randomblob|zeroblob|printf|format)\b/i.test(syntax))throw new Error('Report SQL must be a read-only SELECT');
    db.exec('CREATE TABLE samples(signal TEXT,time INTEGER,value,quality TEXT);CREATE TABLE segments(signal TEXT,start INTEGER,end INTEGER,value,quality TEXT)');
    const sample=db.prepare('INSERT INTO samples VALUES(?,?,?,?)'),numericSample=db.prepare('INSERT INTO samples VALUES(?,?,CAST(? AS REAL),?)'),segment=db.prepare('INSERT INTO segments VALUES(?,?,?,?,?)'),numericSegment=db.prepare('INSERT INTO segments VALUES(?,?,?,CAST(? AS REAL),?)'),value=(v:Value|null)=>typeof v==='boolean'?Number(v):v;
    db.transaction(()=>{for(const s of task.data.samples)(typeof s.value==='number'?numericSample:sample).run(s.signal,s.time,value(s.value),s.quality);for(const s of task.data.segments)(typeof s.value==='number'?numericSegment:segment).run(s.signal,s.start,s.end,value(s.value),s.quality);})();
    db.exec('PRAGMA query_only=ON;PRAGMA trusted_schema=OFF;PRAGMA hard_heap_limit=134217728');
    const named={...task.inputs,from:task.from,to:task.to},bindings:Record<string,number>={};
    for(const m of syntax.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)){const key=m[1]!;if(!Object.hasOwn(named,key))throw new Error('Unknown report parameter: '+key);bindings[':'+key]=named[key as keyof typeof named];}
    const statement=db.query(`SELECT * FROM (\n${sql}\n) LIMIT 2001`);let rows=statement.all(bindings) as Record<string,unknown>[];
    if(rows.length>2000||JSON.stringify(rows).length>1000000)throw new Error('Report exceeds 2000 rows / 1 MB');
    // A missing SQL alias is a schema error even when the query returns zero rows.
    const names=new Set(statement.columnNames);for(const key of Object.keys(task.definition.schema))if(!names.has(key))throw new Error('Missing report field: '+key);
    rows=rows.map(row=>Object.fromEntries(Object.entries(task.definition.schema).map(([key,f])=>{
      let v=row[key];if(v!==null){
        if(f.type==='boolean'&&(v===0||v===1))v=Boolean(v);
        if(f.type==='datetime'){
          if(typeof v!=='number'&&typeof v!=='string'||typeof v==='string'&&!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v))throw new Error('Expected UTC datetime: '+key);
          const d=new Date(v as string|number);if(!Number.isFinite(d.getTime()))throw new Error('Invalid datetime: '+key);v=d.toISOString();
        }else if(typeof v!==f.type||typeof v==='number'&&!Number.isFinite(v))throw new Error('Report schema mismatch: '+key+' expected '+f.type);
      }
      return [key,v];
    })));
    return {kind:'query',id:task.definition.id,label:task.definition.label,from:task.from,to:task.to,generatedAt:Date.now(),revision:task.revision,columns:task.definition.columns,schema:task.definition.schema,rows:rows as Record<string,Value|null>[],definition:task.definition,inputs:task.inputs};
  }finally{db.close();}
}
if(import.meta.main){try{const task=JSON.parse(await Bun.stdin.text()) as QueryTask;process.stdout.write(JSON.stringify(executeQuery(task)));}catch(e){process.stderr.write(e instanceof Error?e.message:String(e));process.exitCode=1;}}

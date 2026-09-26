import type { SQL } from 'bun';
import type { JobInput, JobReceipt, JobState } from '../core/jobs';
import { canonical } from '../core/artifact';
interface Row {id:string;project:string;kind:JobReceipt['kind'];state:JobState;created_at:number|string;updated_at:number|string;input:string;result:string|null;error:string}
const receipt=(r:Row):JobReceipt=>({id:r.id,project:r.project,kind:r.kind,state:r.state,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at),result:r.result?JSON.parse(r.result):null,error:r.error});
/** Durable execution receipts. Workflow SDK owns orchestration and retry policy. */
export class Jobs {
  constructor(readonly sql:SQL){}
  async init(){await this.sql`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,project TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,input TEXT NOT NULL,result TEXT,error TEXT NOT NULL)`;}
  async recover(){await this.sql`UPDATE jobs SET state='interrupted',error='Worker stopped; inspect external effects before starting a new run',updated_at=${Date.now()} WHERE state='running'`;}
  async submit(id:string,input:JobInput){
    if(!/^[a-zA-Z0-9:_.-]{1,240}$/.test(id))throw new Error('Invalid job identity');const at=Date.now(),encoded=canonical(input);
    const existing:Row[]=await this.sql`SELECT * FROM jobs WHERE id=${id}`;
    if(existing[0]){if(existing[0].input!==encoded)throw new Error('Idempotency identity reused with different input');return receipt(existing[0]);}
    const count:{n:number}[]=await this.sql`SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running')`;if(Number(count[0]?.n)>=32)throw new Error('Worker queue is full');
    await this.sql`INSERT INTO jobs (id,project,kind,state,created_at,updated_at,input,result,error) VALUES (${id},${input.project},${input.kind},'queued',${at},${at},${encoded},NULL,'') ON CONFLICT (id) DO NOTHING`;
    const row=await this.input(id);if(canonical(row)!==encoded)throw new Error('Idempotency identity conflict');return (await this.get(id))!;
  }
  async input(id:string):Promise<JobInput>{const rows:Row[]=await this.sql`SELECT * FROM jobs WHERE id=${id}`;if(!rows[0])throw new Error('Unknown job');return JSON.parse(rows[0].input);}
  async get(id:string){const rows:Row[]=await this.sql`SELECT * FROM jobs WHERE id=${id}`;return rows[0]?receipt(rows[0]):null;}
  async list(project:string){const rows:Row[]=await this.sql`SELECT * FROM jobs WHERE project=${project} ORDER BY created_at DESC LIMIT 100`;return rows.map(receipt);}
  async next(){const rows:Row[]=await this.sql`SELECT * FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1`;return rows[0]?receipt(rows[0]):null;}
  async claim(id:string){const rows:{id:string}[]=await this.sql`UPDATE jobs SET state='running',updated_at=${Date.now()} WHERE id=${id} AND state='queued' RETURNING id`;return rows.length===1;}
  async finish(id:string,state:'succeeded'|'failed'|'interrupted',result:unknown,error=''){await this.sql`UPDATE jobs SET state=${state},result=${JSON.stringify(result)},error=${error.slice(0,4000)},updated_at=${Date.now()} WHERE id=${id} AND state='running'`;}
}

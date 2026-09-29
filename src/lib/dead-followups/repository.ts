import 'server-only';
import { Pool } from 'pg';
import { applyControl, ControlError, emptyControls } from './controls';
import type { ControlEvent, ControlRecord, ControlState, DeadQuote } from './types';
let pool: Pool | undefined;
export function controlsRepository(): ControlRepository | null {
  if (!process.env.DATABASE_URL) return null;
  pool ??= new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});
  return new ControlRepository(pool);
}
export function emptyRecord(): ControlRecord {return {revision:0,state:emptyControls(),updatedAt:null,actorName:''};}
function record(row: Record<string,unknown>): ControlRecord {
  return {revision:Number(row.revision),state:row.state as ControlState,actorName:String(row.actor_name),updatedAt:new Date(String(row.updated_at)).toISOString()};
}
export class ControlRepository {
  constructor(private readonly pool: Pool) {}
  async list(ids: string[]): Promise<Record<string,ControlRecord>> {
    if (!ids.length) return {};
    const result=await this.pool.query('SELECT * FROM dead_quote_followup_controls WHERE insulhub_job_id=ANY($1::text[])',[ids]);
    return Object.fromEntries(result.rows.map(row=>[row.insulhub_job_id,record(row)]));
  }
  async events(jobId: string): Promise<ControlEvent[]> {
    const result=await this.pool.query('SELECT * FROM dead_quote_followup_events WHERE insulhub_job_id=$1 ORDER BY revision DESC LIMIT 50',[jobId]);
    return result.rows.map(row=>({revision:row.revision,action:row.action,state:row.state,reason:row.reason,actorName:row.actor_name,createdAt:new Date(row.created_at).toISOString()}));
  }
  async change(job:DeadQuote,revision:number,input:unknown,actor:{id:string;name:string}):Promise<ControlRecord> {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO dead_quote_followup_controls(insulhub_job_id,revision,state) VALUES($1,0,$2::jsonb) ON CONFLICT DO NOTHING',[job._id,JSON.stringify(emptyControls())]);
      const {rows}=await client.query('SELECT * FROM dead_quote_followup_controls WHERE insulhub_job_id=$1 FOR UPDATE',[job._id]);
      if(rows[0].revision!==revision)throw new ControlError('Another staff member changed this follow-up. Refresh before saving again.',409);
      const state=applyControl(rows[0].state,input,job,new Date().toISOString());
      const command=input as {action:string;reason?:string};
      const updated=await client.query('UPDATE dead_quote_followup_controls SET state=$2::jsonb,revision=revision+1,actor_name=$3,updated_at=now() WHERE insulhub_job_id=$1 RETURNING *',[job._id,JSON.stringify(state),actor.name]);
      await client.query('INSERT INTO dead_quote_followup_events(insulhub_job_id,revision,action,state,reason,actor_id,actor_name,quote_version,quote_total) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)',[job._id,revision+1,command.action,JSON.stringify(state),command.reason?.trim() || '',actor.id,actor.name,job.updatedAt,job.quote?.c_total??null]);
      await client.query('COMMIT');
      return record(updated.rows[0]);
    } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}

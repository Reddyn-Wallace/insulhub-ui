import 'server-only';
import {Pool} from 'pg';
import {ControlError} from './controls';
import {defaultTemplates,validateTemplates,type TemplateRecord} from './templates';
let pool:Pool|undefined;
export function templateRepository(){if(!process.env.DATABASE_URL)return null;pool??=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000});return new TemplateRepository(pool);}
function rowRecord(row:Record<string,unknown>):TemplateRecord{return {revision:Number(row.revision),templates:validateTemplates(row.templates),actorName:String(row.actor_name),updatedAt:new Date(String(row.updated_at)).toISOString()};}
export class TemplateRepository{
 constructor(private readonly pool:Pool){}
 async read():Promise<TemplateRecord>{const r=await this.pool.query('SELECT * FROM dead_quote_followup_templates WHERE singleton=true');return r.rows.length?rowRecord(r.rows[0]):{revision:0,templates:defaultTemplates(),actorName:'',updatedAt:null};}
 async events(){const r=await this.pool.query('SELECT revision,templates,actor_name AS "actorName",created_at AS "createdAt" FROM dead_quote_followup_template_events ORDER BY revision DESC LIMIT 20');return r.rows;}
 async save(revision:number,input:unknown,actor:{id:string;name:string}){
  if(!Number.isInteger(revision)||revision<0)throw new ControlError('Refresh templates before saving.');
  const templates=validateTemplates(input);const c=await this.pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended('dead-quote-template-settings',0))");
   const current=await c.query('SELECT revision FROM dead_quote_followup_templates WHERE singleton=true');
   if((current.rows[0]?.revision||0)!==revision)throw new ControlError('Templates changed since you opened them. Reload before saving.',409);
   const r=await c.query('INSERT INTO dead_quote_followup_templates(singleton,revision,templates,actor_name) VALUES(true,$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET revision=EXCLUDED.revision,templates=EXCLUDED.templates,actor_name=EXCLUDED.actor_name,updated_at=now() RETURNING *',[revision+1,JSON.stringify(templates),actor.name]);
   await c.query('INSERT INTO dead_quote_followup_template_events(revision,templates,actor_id,actor_name) VALUES($1,$2,$3,$4)',[revision+1,JSON.stringify(templates),actor.id,actor.name]);
   await c.query('COMMIT');return rowRecord(r.rows[0]);
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
}

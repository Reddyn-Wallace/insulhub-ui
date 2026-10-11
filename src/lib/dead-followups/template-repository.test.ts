import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {TemplateRepository} from './template-repository';
import {defaultTemplates} from './templates';
const url=process.env.DEAD_FOLLOWUPS_TEST_DATABASE_URL;
describe.skipIf(!url)('shared template storage',()=>{
 let pool:Pool;let repo:TemplateRepository;
 beforeAll(async()=>{if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55687')throw Error('Dedicated database only');const setup=new Pool({connectionString:url});await setup.query('CREATE SCHEMA IF NOT EXISTS followup_template_test');await setup.end();pool=new Pool({connectionString:url,options:'-c search_path=followup_template_test'});repo=new TemplateRepository(pool);await pool.query(readFileSync('scripts/dead-followups-template-schema.sql','utf8'));});
 beforeEach(async()=>{await pool.query('TRUNCATE dead_quote_followup_template_events,dead_quote_followup_templates');});
 afterAll(async()=>{await pool?.end();});
 it('defaults are read-only until first save; concurrent edits cannot overwrite',async()=>{
  expect((await repo.read()).revision).toBe(0);
  const changes=defaultTemplates().map(t=>({...t,body:'Hello {{name}}, discount {{discount}}'}));
  const r=await Promise.allSettled([repo.save(0,changes,{id:'a',name:'A'}),repo.save(0,defaultTemplates(),{id:'b',name:'B'})]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await repo.read()).revision).toBe(1);expect((await repo.events())).toHaveLength(1);
 });
 it('saved templates round trip and audit cannot be rewritten',async()=>{await repo.save(0,defaultTemplates(),{id:'a',name:'A'});expect((await repo.read()).templates).toEqual(defaultTemplates());await expect(pool.query("UPDATE dead_quote_followup_template_events SET actor_name='forged'")).rejects.toThrow('immutable');});
});

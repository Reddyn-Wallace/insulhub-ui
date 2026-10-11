import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {migrateFollowupTemplates} from '../contact-template-migration';
import {defaultTemplates} from './templates';
const url=process.env.DEAD_FOLLOWUPS_TEST_DATABASE_URL;
describe.skipIf(!url)('ordinary follow-up template migration',()=>{
 let pool:Pool;
 const sql=async(strings:TemplateStringsArray,...values:unknown[])=>{
  const text=strings.reduce((query,part,index)=>query+(index?'$'+index:'')+part,'');
  return (await pool.query(text,values)).rows;
 };
 beforeAll(async()=>{
  if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55687')throw Error('Dedicated test database only');
  pool=new Pool({connectionString:url,options:'-c search_path=contact_template_migration_test'});
  await pool.query('CREATE SCHEMA IF NOT EXISTS contact_template_migration_test');
  await pool.query('CREATE TABLE IF NOT EXISTS overlay_settings(key text PRIMARY KEY,value text NOT NULL,updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS contact_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL,channel text NOT NULL,description text NOT NULL DEFAULT \'\',subject text NOT NULL DEFAULT \'\',body text NOT NULL,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())');
  await pool.query(readFileSync('scripts/dead-followups-template-schema.sql','utf8'));
 });
 beforeEach(async()=>{await pool.query('TRUNCATE contact_templates,overlay_settings,dead_quote_followup_templates,dead_quote_followup_template_events');});
 afterAll(async()=>{await pool?.end();});
 it('imports custom saved wording once, converts merge fields, and never resurrects deleted templates',async()=>{
  const legacy=defaultTemplates();legacy[0].body='Saved custom wording for {{name}}, quote {{quoteNumber}}, {{discount}}.';
  await pool.query('INSERT INTO dead_quote_followup_templates(singleton,revision,templates,actor_name) VALUES(true,1,$1,\'Admin\')',[JSON.stringify(legacy)]);
  await Promise.all([migrateFollowupTemplates(sql),migrateFollowupTemplates(sql)]);
  const rows=(await pool.query('SELECT * FROM contact_templates ORDER BY channel DESC,sort_order')).rows;
  expect(rows).toHaveLength(4);expect(rows[0].body).toBe('Saved custom wording for {customer name}, quote {quote number}, {discount}.');
  await pool.query('DELETE FROM contact_templates');await migrateFollowupTemplates(sql);
  expect((await pool.query('SELECT * FROM contact_templates')).rows).toHaveLength(0);
  expect((await pool.query('SELECT templates FROM dead_quote_followup_templates')).rows[0].templates).toEqual(legacy);
 });
 it('keeps existing ordinary templates and lets imported templates be edited without reinsertion',async()=>{
  await pool.query("INSERT INTO contact_templates(title,channel,body) VALUES('My own template','sms','Just checking in')");
  await migrateFollowupTemplates(sql);await pool.query("UPDATE contact_templates SET title='Renamed',body='No discount needed' WHERE title LIKE 'Quote follow-up%'");
  await migrateFollowupTemplates(sql);const rows=(await pool.query('SELECT title,body FROM contact_templates')).rows;
  expect(rows).toHaveLength(5);expect(rows.filter(r=>r.title==='Renamed')).toHaveLength(4);expect(rows.some(r=>r.title==='My own template')).toBe(true);
 });
});

import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
vi.mock('@/lib/insulhub-auth',()=>({requireInsulhubAuth:vi.fn(async()=>null)}));
vi.mock('@/lib/overlay-db',()=>({ensureOverlaySchema:vi.fn(),overlaySql:vi.fn()}));
import {overlaySql} from '@/lib/overlay-db';
import {GET,POST} from '@/app/api/contact-templates/route';
import {PATCH,DELETE} from '@/app/api/contact-templates/[id]/route';
import {defaultTemplates} from './templates';
const url=process.env.DEAD_FOLLOWUPS_TEST_DATABASE_URL;
describe.skipIf(!url)('ordinary template routes after follow-up import',()=>{
 let pool:Pool;
 const request=(path='/api/contact-templates',method='GET',body?:unknown)=>new NextRequest('http://localhost'+path,{method,...(body?{body:JSON.stringify(body)}:{})});
 beforeAll(async()=>{
  if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='55687')throw Error('Dedicated test database only');
  pool=new Pool({connectionString:url,options:'-c search_path=contact_template_routes_test'});
  await pool.query('CREATE SCHEMA IF NOT EXISTS contact_template_routes_test');
  await pool.query("CREATE TABLE IF NOT EXISTS overlay_settings(key text PRIMARY KEY,value text NOT NULL,updated_at timestamptz DEFAULT now()); CREATE TABLE IF NOT EXISTS contact_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL,channel text NOT NULL,description text NOT NULL DEFAULT '',subject text NOT NULL DEFAULT '',body text NOT NULL,sort_order integer NOT NULL DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())");
  await pool.query(readFileSync('scripts/dead-followups-template-schema.sql','utf8'));
  vi.mocked(overlaySql).mockImplementation(async(strings,...values)=>(await pool.query(strings.reduce((text,part,i)=>text+(i?'$'+i:'')+part,''),values)).rows);
 });
 beforeEach(async()=>{await pool.query('TRUNCATE contact_templates,overlay_settings,dead_quote_followup_templates,dead_quote_followup_template_events');});
 afterAll(async()=>{await pool?.end();});
 it('can rename, change channel, edit and delete a migrated template without it reappearing',async()=>{
  const old=defaultTemplates();old[0].body='A saved message {{name}} {{discount}}';
  await pool.query("INSERT INTO dead_quote_followup_templates(singleton,revision,templates,actor_name) VALUES(true,1,$1,'Staff')",[JSON.stringify(old)]);
  const list=await GET(request());expect(list.status).toBe(200);const row=(await list.json()).templates.find((t:{body:string})=>t.body==='A saved message {customer name} {discount}');expect(row).toBeTruthy();
  const context={params:Promise.resolve({id:row.id})};
  expect((await PATCH(request('/api/contact-templates/'+row.id,'PATCH',{title:'My plain email',channel:'email',subject:'Checking in',body:'Any questions, {first name}?'}),context)).status).toBe(200);
  const edited=(await (await GET(request('/api/contact-templates?channel=email'))).json()).templates.find((t:{id:string})=>t.id===row.id);expect(edited).toMatchObject({title:'My plain email',body:'Any questions, {first name}?'});
  expect((await DELETE(request('/api/contact-templates/'+row.id,'DELETE'),context)).status).toBe(200);
  const after=(await (await GET(request())).json()).templates;expect(after.some((t:{id:string})=>t.id===row.id)).toBe(false);expect(after.filter((t:{title:string})=>t.title.startsWith('Quote follow-up'))).toHaveLength(3);
 });
 it('creates ordinary templates without required discount fields and returns them by channel',async()=>{
  const response=await POST(request('/api/contact-templates','POST',{title:'My follow-up',channel:'sms',body:'Hi {first name}, any questions?'}));expect(response.status).toBe(201);const saved=(await response.json()).template;
  const list=(await (await GET(request('/api/contact-templates?channel=sms'))).json()).templates;expect(list.some((t:{id:string})=>t.id===saved.id)).toBe(true);
 });
});

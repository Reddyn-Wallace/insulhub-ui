import { beforeEach, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
const m=vi.hoisted(()=>({sql:vi.fn()}));
vi.mock('@/lib/overlay-db',()=>({overlaySql:m.sql}));
import { createGmailState, consumeGmailState } from './communication-oauth-state';
let pool: {query:(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>};
beforeEach(async()=>{
 const db=newDb();pool=new (db.adapters.createPg().Pool)();
 await pool.query('CREATE TABLE communication_oauth_states(state_hash text PRIMARY KEY,sender_id text,owner_user_id text,expires_at timestamptz)');
 m.sql.mockImplementation(async(parts:TemplateStringsArray,...values:unknown[])=>(await pool.query(parts.reduce((q,p,i)=>q+(i?`$${i}`:'')+p,''),values)).rows);
});
it('binds to the browser and consumes authorisation only once, including concurrent callbacks',async()=>{
 const state=await createGmailState('sender','owner');
 expect(await consumeGmailState(state,'different-browser')).toBeNull();
 expect(await consumeGmailState(state)).toBeNull();
 const results=await Promise.all([consumeGmailState(state,state),consumeGmailState(state,state)]);
 expect(results.filter(Boolean)).toEqual([{sender_id:'sender',owner_user_id:'owner'}]);
 expect(await consumeGmailState(state,state)).toBeNull();
});
it('rejects expired grants and stores only a hash of the browser state',async()=>{
 const state=await createGmailState('sender','owner');
 expect(JSON.stringify((await pool.query('SELECT * FROM communication_oauth_states')).rows)).not.toContain(state);
 await pool.query("UPDATE communication_oauth_states SET expires_at='2000-01-01'");
 expect(await consumeGmailState(state,state)).toBeNull();
});

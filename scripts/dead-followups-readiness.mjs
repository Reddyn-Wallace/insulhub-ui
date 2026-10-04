import {Pool} from 'pg';
import nextEnv from '@next/env';
import {checkReadiness} from './lib/dead-followups-readiness.mjs';
nextEnv.loadEnvConfig(process.cwd());
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required. No checks performed.');process.exitCode=1;}
else{
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:10000});
 let client;
 try{
  client=await pool.connect();await client.query('BEGIN READ ONLY');
  const result=await checkReadiness(client);await client.query('ROLLBACK');
  console.log(JSON.stringify({...result,dateCaptureEnabled:process.env.DEAD_QUOTE_DATE_CAPTURE_ENABLED==='true'||process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true',controlsEnabled:process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true',sendingEnabled:process.env.DEAD_QUOTE_FOLLOWUP_SEND_ENABLED==='true',scope:'Storage checks only. Canonical API access, per-staff sender connections and live delivery still require acceptance checks.'},null,2));if(!result.ready)process.exitCode=1;
 }catch{console.error('Could not verify follow-up storage. Check connectivity and schema permissions. No changes were made.');process.exitCode=1;}
 finally{if(client){try{await client.query('ROLLBACK');}catch{}client.release();}await pool.end();}
}

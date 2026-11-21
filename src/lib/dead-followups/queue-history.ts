import 'server-only';
import {getOverlaySql} from '@/lib/overlay-db';
import {applyQueueDeadDates,BATCH_DEAD_DATE_BASELINE_SQL,BATCH_DEAD_DATE_READ_SQL,datesEnabled,queueDateAssumptions} from './date-repository';
import {controlRecords,READ_CONTROLS_SQL} from './repository';
import {READ_SEND_SUMMARIES_SQL,type SendSummary} from './send-repository';
import type {DeadQuote} from './types';

// One snapshot keeps a completed send paired with its newly recorded offer.
export const READ_QUEUE_HISTORY_SQL=`SELECT
  COALESCE((SELECT jsonb_agg(row) FROM (${BATCH_DEAD_DATE_READ_SQL}) row),'[]'::jsonb) AS dates,
  COALESCE((SELECT jsonb_agg(row) FROM (${READ_CONTROLS_SQL}) row),'[]'::jsonb) AS controls,
  COALESCE((SELECT jsonb_agg(row) FROM (${READ_SEND_SUMMARIES_SQL}) row),'[]'::jsonb) AS attempts`;

export async function readBatchedQueueHistory(jobs:DeadQuote[],persistDates?:boolean){
  const databaseUrl=process.env.DATABASE_URL;
  if(!jobs.length||!databaseUrl||!new URL(databaseUrl).hostname.endsWith('.neon.tech'))return null;
  const persist=persistDates??datesEnabled();
  const now=new Date().toISOString();
  const ids=jobs.map(job=>job._id);
  const sql=getOverlaySql();
  try{
    // Keep the baseline and its audit event atomic. The following statement
    // sees the stored date even if a simultaneous save won the insert race.
    const result=await sql.transaction([
      ...(persist?[sql.query(BATCH_DEAD_DATE_BASELINE_SQL,[JSON.stringify(queueDateAssumptions(jobs,now))])]:[]),
      sql.query(READ_QUEUE_HISTORY_SQL,[ids]),
    ],{arrayMode:false,fullResults:false,isolationLevel:'ReadCommitted',readOnly:!persist,fetchOptions:{signal:AbortSignal.timeout(10000)}});
    const rows=result[persist?1:0];
    const snapshot=rows?.[0];
    if(rows?.length!==1||!Array.isArray(snapshot?.dates)||!Array.isArray(snapshot.controls)||!Array.isArray(snapshot.attempts)){
      throw Error('Incomplete follow-up history.');
    }
    return {
      jobs:applyQueueDeadDates(jobs,snapshot.dates,now),
      records:controlRecords(snapshot.controls),
      attempts:snapshot.attempts as SendSummary[],
    };
  }catch(error){
    // The existing per-table path preserves the read-only behavior of older migrations.
    if((error as {code?:string}|null)?.code==='42P01')return null;
    throw error;
  }
}

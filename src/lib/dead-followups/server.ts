import {assumedEntry,quoteInCohort} from './dates';
import 'server-only';
import { addNzMonths, classifyQuote, evaluateFollowup, suggestDeadDate } from './rules';
import { ControlError } from './controls';
import type { DeadQuote, QueueItem, QueueResponse } from './types';

const INDEX_FIELDS = `
  _id jobNumber stage notes archivedAt updatedAt
  lead { leadStatus callbackDate }
  quote { status date }
`;
const CARD_FIELDS = `
  _id jobNumber stage archivedAt updatedAt
  lead { leadStatus callbackDate allocatedTo { firstname lastname } }
  quote { status date c_total extras { name price } }
  client { contactDetails { name streetAddress } }
`;
const indexQuery = `query DeadQuoteIndex($skip: Int, $limit: Int) {
  jobs(stages: [QUOTE], skip: $skip, limit: $limit) { total results { ${INDEX_FIELDS} } }
}`;
const fullQuery = `query DeadQuoteReview($skip: Int, $limit: Int) {
  jobs(stages: [QUOTE], skip: $skip, limit: $limit) {
    total results {
      _id jobNumber stage notes archivedAt updatedAt
      lead { leadStatus callbackDate allocatedTo { firstname lastname } }
      quote { extras { name price } status date quoteNumber c_total quoteNote wall { SQM } ceiling { SQM } }
      client { contactDetails { name streetAddress suburb city } }
    }
  }
}`;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validQuote(value: unknown): value is DeadQuote {
  if (!record(value) || typeof value._id !== 'string' || !value._id || typeof value.stage !== 'string') return false;
  if (!('quote' in value) || !('lead' in value)) return false;
  if (value.quote !== null && (!record(value.quote) || !('status' in value.quote) || (value.quote.status !== null && typeof value.quote.status !== 'string'))) return false;
  if (value.lead !== null && (!record(value.lead) || !('leadStatus' in value.lead) || (value.lead.leadStatus !== null && typeof value.lead.leadStatus !== 'string'))) return false;
  for (const key of ['notes', 'archivedAt']) if (value[key] != null && typeof value[key] !== 'string') return false;
  if (record(value.lead) && value.lead.callbackDate != null && typeof value.lead.callbackDate !== 'string') return false;
  if (record(value.quote)) {
    for (const key of ['date','quoteNote']) if (value.quote[key] != null && typeof value.quote[key] !== 'string') return false;
    if (value.quote.c_total != null && (typeof value.quote.c_total !== 'number' || !Number.isFinite(value.quote.c_total))) return false;
    if(value.quote.extras != null && (!Array.isArray(value.quote.extras)||value.quote.extras.some(extra=>!record(extra)||(extra.name!=null&&typeof extra.name!=='string')||(extra.price!=null&&(typeof extra.price!=='number'||!Number.isFinite(extra.price))))))return false;
    for (const key of ['wall','ceiling']) {
      const scope=value.quote[key];
      if (scope != null && (!record(scope) || (scope.SQM != null && (typeof scope.SQM !== 'number' || !Number.isFinite(scope.SQM))))) return false;
    }
  }
  if (value.client != null) {
    if (!record(value.client)) return false;
    const contact=value.client.contactDetails;
    if (contact != null) {
      if (!record(contact)) return false;
      for (const key of ['name','streetAddress','suburb','city','email','phoneMobile','phoneSecondary']) if (contact[key] != null && typeof contact[key] !== 'string') return false;
    }
  }
  return true;
}
const SCAN_ERROR = 'The full quote list could not be verified. Refresh and try again.';

export function assertQuoteAccess(status: number, errors?: unknown) {
  if(status===401)throw new ControlError('Sign in again to view quotes.',401);
  if(status===403)throw new ControlError('Your account cannot access these quotes.',403);
  if(!Array.isArray(errors))return;
  for(const error of errors){
    const code=error?.extensions?.code;
    const statusCode=Number(error?.extensions?.exception?.statusCode);
    if(code==='UNAUTHENTICATED'||code==='UNAUTHORIZED'||statusCode===401)throw new ControlError('Sign in again to view quotes.',401);
    if(code==='FORBIDDEN'||statusCode===403)throw new ControlError('Your account cannot access these quotes.',403);
  }
}

export function quoteQueueItem(job: DeadQuote, checkedAt: string, withSuggestion = true): QueueItem {
  job = {...job,deadEntry:job.deadEntry === undefined ? assumedEntry(job,checkedAt) : job.deadEntry};
  const suggestion=withSuggestion ? suggestDeadDate(job.notes,checkedAt) : null;
  return {
    job,suggestion,earliestFirstApproach:job.deadEntry ? addNzMonths(job.deadEntry.at,2) : null,
    eligibility:evaluateFollowup(job,{entry:suggestion ? {at:suggestion.at,provenance:'note'} : null,historyReviewed:false,approaches:[]},checkedAt),
  };
}

export async function loadDeadQuoteQueue(token: string, checkedAt = new Date().toISOString(), indexOnly = false): Promise<QueueResponse> {
  const items: QueueItem[] = [];
  const quoteCounts={OPEN:0,CALLBACK:0,DEAD:0,ALL:0};
  const seen = new Set<string>();
  const signal = AbortSignal.timeout(40000);
  try {
    async function page(skip:number){
      const response=await fetch('https://api.insulhub.nz/graphql',{method:'POST',cache:'no-store',redirect:'error',signal,headers:{'content-type':'application/json','x-access-token':token},body:JSON.stringify({query:indexOnly ? indexQuery : fullQuery,variables:{skip,limit:indexOnly ? 500 : 250}})});
      assertQuoteAccess(response.status);
      if(!response.ok)throw Error(SCAN_ERROR);
      const json=await response.json();const value=json.data?.jobs;
      assertQuoteAccess(response.status,json.errors);
      if(json.errors?.length||!Number.isInteger(value?.total)||value.total<0||value.total>10000||!Array.isArray(value.results))throw Error(SCAN_ERROR);
      return value as {total:number;results:unknown[]};
    }
    const first=await page(0);const total=first.total;const size=first.results.length;
    if((!size&&total>0)||size>total)throw Error(SCAN_ERROR);
    function consume(result:{total:number;results:unknown[]},offset:number){
      if(result.total!==total||result.results.length!==Math.min(size,total-offset))throw Error(SCAN_ERROR);
      for(const value of result.results){
        if(!validQuote(value)||seen.has(value._id))throw Error(SCAN_ERROR);seen.add(value._id);
        const job=value;
        if(job.stage==='QUOTE'&&!job.archivedAt){
          quoteCounts.ALL++;
          if(job.lead?.leadStatus==='DEAD'||job.quote?.status==='DECLINED')quoteCounts.DEAD++;
          else if(job.quote?.status==='DEFERRED'||['CALLBACK','ON_HOLD'].includes((job.lead?.leadStatus||'').toUpperCase()))quoteCounts.CALLBACK++;
          else quoteCounts.OPEN++;
        }
        if(classifyQuote(job)==='excluded'||!quoteInCohort(job))continue;
        items.push(quoteQueueItem(job,checkedAt,!indexOnly));
      }
    }
    consume(first,0);
    // The first actual page size honours backend caps. Never assume requested limit was returned.
    // Keep four workers busy: a slow page must not hold up the next batch.
    let nextOffset=size;
    await Promise.all(Array.from({length:Math.min(4,size?Math.ceil((total-size)/size):0)},async()=>{
      while(nextOffset<total){
        const offset=nextOffset;nextOffset+=size;
        consume(await page(offset),offset);
      }
    }));
    if(seen.size!==total)throw Error(SCAN_ERROR);
  } catch(error) {
    if(error instanceof ControlError)throw error;
    throw Error(SCAN_ERROR);
  }
  items.sort((a,b) => (a.suggestion?.at || '9999').localeCompare(b.suggestion?.at || '9999') || a.job._id.localeCompare(b.job._id));
  return {items,quoteCounts,checkedAt,readOnly:true,historyAvailable:false};
}

export async function loadFollowupCards(token: string, items: QueueItem[]) {
  const cards: QueueItem[] = [];
  const batchSize = 25;
  const signal = AbortSignal.timeout(10000);
  let next = 0;
  await Promise.all(Array.from({length:Math.min(4,Math.ceil(items.length/batchSize))},async()=>{
    while(next<items.length){
      const start=next;
      next+=batchSize;
      const batch=items.slice(start,next);
      const variables=Object.fromEntries(batch.map((item,index)=>[`id${index}`,item.job._id]));
      const args=Object.keys(variables).map(name=>`$${name}: ObjectId!`).join(', ');
      const fields=batch.map((_,index)=>`row${index}: job(_id: $id${index}) { ${CARD_FIELDS} }`).join('\n');
      const response=await fetch('https://api.insulhub.nz/graphql',{
        method:'POST',cache:'no-store',redirect:'error',signal,headers:{'content-type':'application/json','x-access-token':token},
        body:JSON.stringify({query:`query DeadQuoteCards(${args}) { ${fields} }`,variables}),
      });
      assertQuoteAccess(response.status);
      if(!response.ok)throw Error(SCAN_ERROR);
      const json=await response.json();
      assertQuoteAccess(response.status,json.errors);
      if(json.errors?.length)throw Error(SCAN_ERROR);
      batch.forEach((item,index)=>{
        const job=json.data?.[`row${index}`];
        const source=item.job;
        if(!validQuote(job)||job._id!==source._id||job.updatedAt!==source.updatedAt||
           job.stage!==source.stage||job.archivedAt!==source.archivedAt||
           job.lead?.leadStatus!==source.lead?.leadStatus||job.lead?.callbackDate!==source.lead?.callbackDate||
           job.quote?.status!==source.quote?.status||job.quote?.date!==source.quote?.date)throw Error(SCAN_ERROR);
        const {deadEntry,deadDateUncertain}=source;
        const {controls,eligibility,earliestFirstApproach,notePending}=item;
        cards[start+index]={
          job:{
            _id:job._id,jobNumber:job.jobNumber,stage:job.stage,updatedAt:job.updatedAt,archivedAt:job.archivedAt,
            lead:job.lead,quote:job.quote,client:job.client,
            deadEntry:deadEntry ? {...deadEntry,evidence:''} : deadEntry,deadDateUncertain,
          },
          controls:controls && {
            ...controls,actorName:'',
            state:{...controls.state,dateEvidence:'',offers:controls.state.offers.map(offer=>({...offer,evidence:''}))},
          },
          eligibility,earliestFirstApproach,notePending,suggestion:null,
        };
      });
    }
  }));
  return cards;
}

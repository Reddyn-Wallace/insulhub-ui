import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {getOverlaySql} from '@/lib/overlay-db';
import {emptyControls} from './controls';
import {readBatchedQueueHistory} from './queue-history';
import type {DeadQuote} from './types';

vi.mock('@/lib/overlay-db',()=>({getOverlaySql:vi.fn()}));

const job:DeadQuote={_id:'a',stage:'QUOTE',updatedAt:'2026-09-01T00:00:00.000Z',lead:{leadStatus:'DEAD'},quote:{status:'DECLINED',date:'2026-01-01'}};
const entry={at:'2026-04-01T00:00:00Z',source:'ui_transition',evidence:'Recorded entry'};
const state={...emptyControls(),reviewedVersion:job.updatedAt};
const query=vi.fn((statement:string,values:unknown[])=>({statement,values}));
const transaction=vi.fn(async(_statements:unknown,_options:unknown):Promise<Record<string,unknown>[][]>=>[]);

beforeEach(()=>{
  vi.stubEnv('DATABASE_URL','postgresql://test:test@ep-test.ap-southeast-2.aws.neon.tech/test');
  vi.stubEnv('DEAD_QUOTE_FOLLOWUPS_ENABLED','true');
  vi.mocked(getOverlaySql).mockReturnValue({query,transaction} as never);
});
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});

it('initialises dates and reads dates, controls and send statuses in one database request',async()=>{
  const attempt={insulhub_job_id:'a',status:'sending',note_status:'pending'};
  transaction.mockResolvedValueOnce([
    [],
    [{
      dates:[{insulhub_job_id:'a',entry,pending:true}],
      controls:[{insulhub_job_id:'a',revision:3,state,actor_name:'Staff',updated_at:job.updatedAt}],
      attempts:[attempt],
    }],
  ]);

  expect(await readBatchedQueueHistory([job])).toEqual({
    jobs:[{...job,deadEntry:entry,deadDateUncertain:true}],
    records:{a:{revision:3,state,updatedAt:job.updatedAt,actorName:'Staff'}},
    attempts:[attempt],
  });
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
  for(const table of ['dead_quote_dates','dead_quote_followup_controls','dead_quote_followup_attempts']){
    expect(query.mock.calls[1][0]).toContain('FROM '+table);
  }
  expect(query.mock.calls[1][1]).toEqual([['a']]);
});

it('leaves dates untouched during standalone detail reads',async()=>{
  transaction.mockResolvedValueOnce([[{dates:[],controls:[],attempts:[]}]]);
  const history=await readBatchedQueueHistory([job],false);
  expect(query).toHaveBeenCalledTimes(1);
  expect(transaction.mock.calls[0][1]).toMatchObject({readOnly:true});
  expect(history?.jobs[0].deadEntry?.source).toBe('quote_plus_30');
});

it('uses the existing compatibility path for a missing migration',async()=>{
  transaction.mockRejectedValueOnce({code:'42P01'});
  expect(await readBatchedQueueHistory([job])).toBeNull();
});

it('fails closed when the batched read fails for any other reason',async()=>{
  transaction.mockRejectedValueOnce(new Error('Database unavailable'));
  await expect(readBatchedQueueHistory([job])).rejects.toThrow('Database unavailable');
});

it('skips the batch for an empty input or a local Postgres connection',async()=>{
  expect(await readBatchedQueueHistory([])).toBeNull();
  vi.stubEnv('DATABASE_URL','postgresql://test:test@127.0.0.1:55687/test');
  expect(await readBatchedQueueHistory([job])).toBeNull();
  expect(transaction).not.toHaveBeenCalled();
});

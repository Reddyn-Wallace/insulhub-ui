// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import DeadFollowupsPage from '@/app/jobs/follow-ups/page';
import StageTabs from '@/components/StageTabs';
import {readSharedBrowser} from '@/lib/crm-read/shared-browser';
import {emptyControls} from './controls';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/lib/crm-read/shared-browser',()=>({readSharedBrowser:vi.fn(async()=>null),persistSharedBrowser:vi.fn(async()=>{})}));
const payload={items:[{job:{_id:'quote1',jobNumber:123,stage:'QUOTE',notes:'29/01/26 - Marked as Dead - Staff',quote:{status:'DECLINED',date:'2026-01-01T00:00:00Z',c_total:12500,wall:{SQM:90},ceiling:{SQM:50}},client:{contactDetails:{name:'Alex Example',streetAddress:'12 Test Street'}}},eligibility:{state:'review',reason:'Review previous offers before deciding the next approach.'},suggestion:{date:'2026-01-29',provenance:'note',evidence:'29/01/26 - Marked as Dead - Staff',at:'2026-01-29T10:59:59.999Z'},earliestFirstApproach:'2026-03-29T10:59:59.999Z'}],checkedAt:'2026-09-29T00:00:00Z',readOnly:true,historyAvailable:false};
let tokenSequence=0;
beforeEach(()=>{
  const token=`test-token-${++tokenSequence}`;
  vi.stubGlobal('localStorage',{getItem:()=> token});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(payload)));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.mocked(readSharedBrowser).mockClear();});
it('shows scope and price without the removed explanation panels',async()=>{
  render(<DeadFollowupsPage/>);
  fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
  expect(screen.queryByText('Previous offers not yet reviewed')).toBeNull();
  expect(screen.queryByText('Review the quote’s age, scope and pricing before making an offer.')).toBeNull();
  expect(screen.getByText(/90 m²/)).toBeTruthy();
  expect(screen.getAllByText(/12,500/).length).toBeGreaterThan(0);
  expect(screen.queryByText('Estimated from a note — not confirmed')).toBeNull();
  expect(screen.getByRole('button',{name:'Send Offer'}).matches(':disabled')).toBe(true);
  expect(screen.getByRole('link',{name:/Open full quote/}).getAttribute('href')).toContain('/jobs/quote1');
});
it('offers retry when loading fails without showing a false empty queue',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:503}));render(<DeadFollowupsPage/>);await screen.findByRole('alert');expect(screen.queryByText('No quotes need following up right now.')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByRole('button',{name:/Alex Example/});expect(screen.queryByRole('alert')).toBeNull();
});
it('distinguishes a verified empty list from loading/error',async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json({...payload,items:[]}));render(<DeadFollowupsPage/>);
  expect(await screen.findByText('No quotes need following up right now.')).toBeTruthy();
});
it('links follow-ups beside Dead for quotes only',()=>{
  const view=render(<StageTabs activeStage="LEAD" subTab="DEAD" onSubTabChange={()=>{}}/>);
  expect(screen.queryByRole('link',{name:/^Follow-ups/})).toBeNull();
  view.rerender(<StageTabs activeStage="QUOTE" subTab="DEAD" onSubTabChange={()=>{}}/>);
  expect(screen.getByRole('link',{name:/^Follow-ups/}).getAttribute('href')).toBe('/jobs/follow-ups?stage=QUOTE');
});
it('does not show customer data after access is refused',async()=>{vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:401}));render(<DeadFollowupsPage/>);await screen.findByRole('alert');expect(screen.queryByRole('button',{name:/Alex Example/})).toBeNull();});
it('shows staff-reviewed date rather than unknown when there was no note suggestion',async()=>{
 const state={draftDiscountCents:null,snoozedUntil:null,exclusionReason:null,deadDate:'2026-09-01T11:59:59.999Z',dateEvidence:'Staff evidence',reviewedVersion:'v1',offers:[]};
 vi.mocked(fetch).mockResolvedValue(Response.json({...payload,historyAvailable:true,readOnly:false,items:[{...payload.items[0],suggestion:null,controls:{revision:1,state,actorName:'Staff',updatedAt:null}}]}));
 render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
 expect(screen.queryByRole('heading',{name:'Dead entry date unknown'})).toBeNull();
 expect(screen.queryByText('Dead date unknown')).toBeNull();
});
it('hides pending sends and has no filter dropdown or pills',async()=>{
 vi.mocked(fetch).mockResolvedValue(Response.json({...payload,items:[{...payload.items[0],eligibility:{state:'attention',reason:'Check saved sending status'}}]}));
 render(<DeadFollowupsPage/>);await screen.findByText('No quotes need following up right now.');expect(screen.queryByRole('button',{name:'Needs review'})).toBeNull();expect(screen.queryByRole('combobox',{name:'Show quotes'})).toBeNull();
});

it.each([null,{SQM:0}])('flags negative extras and omits absent ceiling %j',async(ceiling)=>{
 const row=payload.items[0];vi.mocked(fetch).mockResolvedValue(Response.json({...payload,items:[{...row,job:{...row.job,quote:{...row.job.quote,ceiling,extras:[{name:'Promo',price:-750}]}}}]}));
 render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
 expect(screen.getByText('Already discounted')).toBeTruthy();expect(screen.getByText('Existing discount: $750 excl. GST')).toBeTruthy();expect(screen.queryByText(/Ceiling:/)).toBeNull();
});

it('shows the last verified queue immediately on return without refetching a fresh snapshot',async()=>{
 const view=render(<DeadFollowupsPage/>);await screen.findByRole('button',{name:/Alex Example/});view.unmount();
 vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));render(<DeadFollowupsPage/>);
 expect(await screen.findByRole('button',{name:/Alex Example/})).toBeTruthy();expect(screen.queryByRole('button',{name:'Refresh'})).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
});

it('preserves cents when displaying existing discounts',async()=>{const row=payload.items[0];vi.mocked(fetch).mockResolvedValue(Response.json({...payload,items:[{...row,job:{...row.job,quote:{...row.job.quote,extras:[{name:'Promo',price:-750.25}]}}}]}));render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));expect(screen.getByText('Existing discount: $750.25 excl. GST')).toBeTruthy();});

it('keeps quote states visible and counts only due follow-ups on the active tab',async()=>{render(<DeadFollowupsPage/>);await screen.findByRole('button',{name:/Alex Example/});expect(screen.getByRole('button',{name:/^Open/})).toBeTruthy();expect(screen.getByRole('button',{name:/^Callback/})).toBeTruthy();expect(screen.getByRole('button',{name:/^Dead/})).toBeTruthy();expect(screen.getByRole('link',{name:/Follow-ups\s*\(1\)/}).getAttribute('aria-current')).toBe('page');});
it('loads the follow-up badge on the Quotes navigation',async()=>{render(<StageTabs activeStage="QUOTE" subTab="OPEN" onSubTabChange={()=>{}}/>);expect(await screen.findByRole('link',{name:/Follow-ups\s*\(1\)/})).toBeTruthy();});

it('retains the verified badge when returning from Follow-ups before its request completes',()=>{const first=render(<StageTabs activeStage="QUOTE" subTab="FOLLOW_UPS" followupCount={94} onSubTabChange={()=>{}}/>);first.unmount();vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));render(<StageTabs activeStage="QUOTE" subTab="DEAD" onSubTabChange={()=>{}}/>);expect(screen.getByRole('link',{name:/Follow-ups\s*\(94\)/})).toBeTruthy();});
it('does not restart the count request when switching quote state tabs',async()=>{const view=render(<StageTabs activeStage="QUOTE" subTab="OPEN" onSubTabChange={()=>{}}/>);await screen.findByRole('link',{name:/Follow-ups\s*\(1\)/});view.rerender(<StageTabs activeStage="QUOTE" subTab="DEAD" onSubTabChange={()=>{}}/>);expect(fetch).toHaveBeenCalledTimes(1);});

it('reuses the queue prefetched by the quote navigation',async()=>{const nav=render(<StageTabs activeStage="QUOTE" subTab="OPEN" onSubTabChange={()=>{}}/>);await screen.findByRole('link',{name:/Follow-ups\s*\(1\)/});nav.unmount();render(<DeadFollowupsPage/>);await screen.findByRole('button',{name:/Alex Example/});expect(fetch).toHaveBeenCalledTimes(1);});

it('preserves all quote tab counts when entering Follow-ups',()=>{const nav=render(<StageTabs activeStage="QUOTE" subTab="OPEN" counts={{OPEN:43,CALLBACK:33,DEAD:1057,ALL:1133}} onSubTabChange={()=>{}}/>);nav.unmount();render(<StageTabs activeStage="QUOTE" subTab="FOLLOW_UPS" followupCount={94} onSubTabChange={()=>{}}/>);expect(screen.getByRole('button',{name:/Open\s*\(43\)/})).toBeTruthy();expect(screen.getByRole('button',{name:/Dead\s*\(1057\)/})).toBeTruthy();});

it('shows quote date and assigned salesperson in the queue, with an unassigned fallback',async()=>{
 const row=payload.items[0];
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({...payload,items:[{...row,job:{...row.job,lead:{allocatedTo:{firstname:'Sam',lastname:'Taylor'}}}},{...row,job:{...row.job,_id:'unassigned',client:{contactDetails:{name:'Unassigned Example'}}}}]}));
 render(<DeadFollowupsPage/>);
 const assigned=await screen.findByRole('button',{name:/Alex Example/});
 expect(within(assigned).getByText('1 Jan 2026')).toBeTruthy();
 expect(within(assigned).getByText('Sam Taylor')).toBeTruthy();
 expect(within(screen.getByRole('button',{name:/Unassigned Example/})).getByText('Unassigned')).toBeTruthy();
});
it('displays a stale queue on return but keeps actions disabled until refreshing succeeds',async()=>{
 const originalNow=Date.now();const now=vi.spyOn(Date,'now');now.mockReturnValue(originalNow);
 try {
 const editable={...payload,readOnly:false,items:[{...payload.items[0],controls:{revision:1,state:{draftDiscountCents:null,snoozedUntil:null,exclusionReason:null,deadDate:null,dateEvidence:'',reviewedVersion:null,offers:[]},actorName:'Staff',updatedAt:null}}]};
 vi.mocked(fetch).mockResolvedValueOnce(Response.json(editable));
 const view=render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
 expect(screen.getByRole('button',{name:'Skip for now'}).matches(':disabled')).toBe(false);view.unmount();
 now.mockReturnValue(originalNow+60_000);
 let finish!:(response:Response)=>void;
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 render(<DeadFollowupsPage/>);
 const row=screen.getByRole('button',{name:/Alex Example/});fireEvent.click(row);
 expect(screen.getByRole('button',{name:'Skip for now'}).matches(':disabled')).toBe(true);
 expect(screen.getByRole('status').textContent).toContain('Updating quotes');
 finish(Response.json(editable));
 await waitFor(()=>expect(screen.queryByText('Updating quotes…')).toBeNull());
 expect(screen.getByRole('button',{name:'Skip for now'}).matches(':disabled')).toBe(false);
 }finally{now.mockRestore();}
});

const deferredPayload={...payload,detailsDeferred:true as const,items:payload.items.map(row=>({
 ...row,suggestion:null,job:{...row.job,notes:undefined,quote:{...row.job.quote,wall:undefined,ceiling:undefined}},
}))};

it('paints a saved queue while refreshing and waits for selected quote details and history before showing actions',async()=>{
 let finishQueue!:(response:Response)=>void;
 let finishDetail!:(response:Response)=>void;
 vi.mocked(readSharedBrowser).mockResolvedValueOnce({checkedAt:Date.now(),data:deferredPayload});
 vi.mocked(fetch)
  .mockImplementationOnce(()=>new Promise(resolve=>{finishQueue=resolve;}))
  .mockImplementationOnce(()=>new Promise(resolve=>{finishDetail=resolve;}));

 render(<DeadFollowupsPage/>);
 fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
 expect(screen.getByText('Updating quotes…')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Send Offer'})).toBeNull();
 expect(fetch).toHaveBeenCalledTimes(1);

 finishQueue(Response.json({...deferredPayload,readOnly:false}));
 await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/dead-followups?jobId=quote1',expect.anything()));
 expect(screen.queryByRole('button',{name:'Skip for now'})).toBeNull();
 expect(screen.queryByText(/90 m²/)).toBeNull();

 const verified={...payload.items[0],controls:{revision:1,state:emptyControls(),actorName:'Staff',updatedAt:null}};
 finishDetail(Response.json({...payload,readOnly:false,items:[verified]}));
 expect(await screen.findByText(/90 m²/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Skip for now'}).matches(':disabled')).toBe(false);
 expect(screen.getByRole('button',{name:'Send Offer'}).matches(':disabled')).toBe(true);
});

it('removes a recovered queue when a fresh request refuses access',async()=>{
 let finish!:(response:Response)=>void;
 vi.mocked(readSharedBrowser).mockResolvedValueOnce({checkedAt:Date.now(),data:deferredPayload});
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));

 render(<DeadFollowupsPage/>);
 await screen.findByRole('button',{name:/Alex Example/});
 finish(new Response('',{status:403}));
 await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:/Alex Example/})).toBeNull();
});

it('leaves actions unavailable if a quote is no longer due when selected',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce(Response.json(deferredPayload)).mockResolvedValueOnce(new Response('',{status:409}));
 render(<DeadFollowupsPage/>);
 fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
 expect((await screen.findByRole('alert')).textContent).toContain('This quote is no longer in the current queue.');
 expect(screen.queryByRole('button',{name:'Send Offer'})).toBeNull();
 expect(screen.getByRole('button',{name:'Refresh queue'})).toBeTruthy();
});

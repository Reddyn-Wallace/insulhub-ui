// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeadFollowupsPage from '@/app/jobs/follow-ups/page';
import StageTabs from '@/components/StageTabs';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
const payload={items:[{job:{_id:'quote1',jobNumber:123,stage:'QUOTE',notes:'29/01/26 - Marked as Dead - Staff',quote:{status:'DECLINED',date:'2026-01-01T00:00:00Z',c_total:12500,wall:{SQM:90},ceiling:{SQM:50}},client:{contactDetails:{name:'Alex Example',streetAddress:'12 Test Street'}}},eligibility:{state:'review',reason:'Review previous offers before deciding the next approach.'},suggestion:{date:'2026-01-29',provenance:'note',evidence:'29/01/26 - Marked as Dead - Staff',at:'2026-01-29T10:59:59.999Z'},earliestFirstApproach:'2026-03-29T10:59:59.999Z'}],checkedAt:'2026-09-29T00:00:00Z',readOnly:true,historyAvailable:false};
let tokenSequence=0;
beforeEach(()=>{
  const token=`test-token-${++tokenSequence}`;
  vi.stubGlobal('localStorage',{getItem:()=> token});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(payload)));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
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
it('retains loaded quotes on refresh failure and offers retry, not an empty queue',async()=>{
  render(<DeadFollowupsPage/>);await screen.findByRole('button',{name:/Alex Example/});
  vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:503}));
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button',{name:/Alex Example/})).toBeTruthy();
  expect(screen.queryByText('No quotes need following up right now.')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
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
it('clears customer details when access expires during refresh',async()=>{
  render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
  vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:401}));
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/Alex Example/})).toBeNull();
  expect(screen.queryByRole('region',{name:'Selected quote'})).toBeNull();
  expect(screen.queryByText('12 Test Street')).toBeNull();
});
it('shows staff-reviewed date rather than unknown when there was no note suggestion',async()=>{
 const state={draftDiscountCents:null,snoozedUntil:null,exclusionReason:null,deadDate:'2026-09-01T11:59:59.999Z',dateEvidence:'Staff evidence',reviewedVersion:'v1',offers:[]};
 vi.mocked(fetch).mockResolvedValue(Response.json({...payload,historyAvailable:true,readOnly:false,items:[{...payload.items[0],suggestion:null,controls:{revision:1,state,actorName:'Staff',updatedAt:null}}]}));
 render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
 expect(screen.queryByRole('heading',{name:'Dead entry date unknown'})).toBeNull();
 expect(screen.queryByText('Dead date unknown')).toBeNull();
});
it('keeps controls disabled while retrying a failed refresh',async()=>{
 const state={draftDiscountCents:null,snoozedUntil:null,exclusionReason:null,deadDate:null,dateEvidence:'',reviewedVersion:null,offers:[]};
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({...payload,historyAvailable:true,readOnly:false,items:[{...payload.items[0],controls:{revision:0,state,actorName:'',updatedAt:null}}]}));
 render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
 vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:503}));fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByRole('alert');
 vi.mocked(fetch).mockImplementationOnce(()=>new Promise(()=>{}));fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 expect(screen.getByRole('button',{name:'Skip for now'}).matches(':disabled')).toBe(true);
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

it('shows the last verified queue immediately on return while refreshing in the background',async()=>{
 const view=render(<DeadFollowupsPage/>);await screen.findByRole('button',{name:/Alex Example/});view.unmount();
 vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));render(<DeadFollowupsPage/>);
 expect(await screen.findByRole('button',{name:/Alex Example/})).toBeTruthy();expect(screen.getByRole('button',{name:'Loading…'}).matches(':disabled')).toBe(true);
});

it('preserves cents when displaying existing discounts',async()=>{const row=payload.items[0];vi.mocked(fetch).mockResolvedValue(Response.json({...payload,items:[{...row,job:{...row.job,quote:{...row.job.quote,extras:[{name:'Promo',price:-750.25}]}}}]}));render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));expect(screen.getByText('Existing discount: $750.25 excl. GST')).toBeTruthy();});

it('keeps quote states visible and counts only due follow-ups on the active tab',async()=>{render(<DeadFollowupsPage/>);await screen.findByRole('button',{name:/Alex Example/});expect(screen.getByRole('button',{name:'Open'})).toBeTruthy();expect(screen.getByRole('button',{name:'Callback'})).toBeTruthy();expect(screen.getByRole('button',{name:'Dead'})).toBeTruthy();expect(screen.getByRole('link',{name:/Follow-ups\s*\(1\)/}).getAttribute('aria-current')).toBe('page');});
it('loads the follow-up badge on the Quotes navigation',async()=>{render(<StageTabs activeStage="QUOTE" subTab="OPEN" onSubTabChange={()=>{}}/>);expect(await screen.findByRole('link',{name:/Follow-ups\s*\(1\)/})).toBeTruthy();});

it('retains the verified badge when returning from Follow-ups before its request completes',()=>{const first=render(<StageTabs activeStage="QUOTE" subTab="FOLLOW_UPS" followupCount={94} onSubTabChange={()=>{}}/>);first.unmount();vi.mocked(fetch).mockImplementation(()=>new Promise(()=>{}));render(<StageTabs activeStage="QUOTE" subTab="DEAD" onSubTabChange={()=>{}}/>);expect(screen.getByRole('link',{name:/Follow-ups\s*\(94\)/})).toBeTruthy();});
it('does not restart the count request when switching quote state tabs',async()=>{const view=render(<StageTabs activeStage="QUOTE" subTab="OPEN" onSubTabChange={()=>{}}/>);await screen.findByRole('link',{name:/Follow-ups\s*\(1\)/});view.rerender(<StageTabs activeStage="QUOTE" subTab="DEAD" onSubTabChange={()=>{}}/>);expect(fetch).toHaveBeenCalledTimes(1);});

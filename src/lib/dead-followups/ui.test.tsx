// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeadFollowupsPage from '@/app/jobs/follow-ups/page';
import StageTabs from '@/components/StageTabs';
const payload={items:[{job:{_id:'quote1',jobNumber:123,stage:'QUOTE',notes:'29/01/26 - Marked as Dead - Staff',quote:{status:'DECLINED',date:'2025-12-01T00:00:00Z',c_total:12500,wall:{SQM:90},ceiling:{SQM:50}},client:{contactDetails:{name:'Alex Example',streetAddress:'12 Test Street'}}},eligibility:{state:'review',reason:'Review previous offers before deciding the next approach.'},suggestion:{date:'2026-01-29',provenance:'note',evidence:'29/01/26 - Marked as Dead - Staff',at:'2026-01-29T10:59:59.999Z'},earliestFirstApproach:'2026-03-29T10:59:59.999Z'}],checkedAt:'2026-09-29T00:00:00Z',readOnly:true,historyAvailable:false};
beforeEach(()=>{
  vi.stubGlobal('localStorage',{getItem:()=> 'test-token'});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(payload)));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('shows evidence, scope, price and unknown previous offers without sending controls',async()=>{
  render(<DeadFollowupsPage/>);
  fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
  expect(screen.getByText('Previous offers not yet reviewed')).toBeTruthy();
  expect(screen.getByText(/90 m²/)).toBeTruthy();
  expect(screen.getAllByText(/12,500/).length).toBeGreaterThan(0);
  expect(screen.getByText('Estimated from a note — not confirmed')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/send/i})).toBeNull();
  expect(screen.getByRole('link',{name:/Open full quote/}).getAttribute('href')).toContain('/jobs/quote1');
});
it('retains loaded quotes on refresh failure and offers retry, not an empty queue',async()=>{
  render(<DeadFollowupsPage/>);await screen.findByRole('button',{name:/Alex Example/});
  vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status:503}));
  fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button',{name:/Alex Example/})).toBeTruthy();
  expect(screen.queryByText('No Dead quotes found.')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});
it('distinguishes a verified empty list from loading/error',async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json({...payload,items:[]}));render(<DeadFollowupsPage/>);
  expect(await screen.findByText('No Dead quotes found.')).toBeTruthy();
});
it('links follow-ups beside Dead for quotes only',()=>{
  const view=render(<StageTabs activeStage="LEAD" subTab="DEAD" onSubTabChange={()=>{}}/>);
  expect(screen.queryByRole('link',{name:'Follow-ups'})).toBeNull();
  view.rerender(<StageTabs activeStage="QUOTE" subTab="DEAD" onSubTabChange={()=>{}}/>);
  expect(screen.getByRole('link',{name:'Follow-ups'}).getAttribute('href')).toBe('/jobs/follow-ups?stage=QUOTE');
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
it('skip hides a quote for this session, with an undo control',async()=>{
 render(<DeadFollowupsPage/>);fireEvent.click(await screen.findByRole('button',{name:/Alex Example/}));
 fireEvent.click(screen.getByRole('button',{name:'Skip for now'}));
 expect(screen.queryByRole('button',{name:/Alex Example/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Undo skip'}));
 expect(screen.getByRole('button',{name:/Alex Example/})).toBeTruthy();
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
 expect(screen.getByRole('button',{name:'Save discount draft'}).matches(':disabled')).toBe(true);
});

// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import FollowupControls from '@/components/FollowupControls';
import {emptyControls} from './controls';
const item={job:{_id:'aaaaaaaaaaaaaaaaaaaaaaaa',stage:'QUOTE',updatedAt:'2026-09-01T00:00:00Z',quote:{status:'DECLINED',c_total:10000}},suggestion:null,earliestFirstApproach:null,eligibility:{state:'review' as const,reason:'Check history'},controls:{revision:0,state:emptyControls(),actorName:'',updatedAt:null}};
beforeEach(()=>{vi.stubGlobal('localStorage',{getItem:()=> 'token'});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('saves a draft discount with revision and canonical version, without sending',async()=>{
 const sent:unknown[]=[];vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{sent.push(JSON.parse(init.body));return Response.json({record:{...item.controls,revision:1,state:{...emptyControls(),draftDiscountCents:50000}}});}));
 render(<FollowupControls item={item} onSaved={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Discount offered (NZD)'),{target:{value:'500'}});fireEvent.click(screen.getByRole('button',{name:'Save discount draft'}));
 expect(await screen.findByRole('status')).toBeTruthy();expect(sent[0]).toMatchObject({revision:0,jobVersion:item.job.updatedAt,command:{action:'discount',amount:'500'}});
 expect(screen.queryByRole('button',{name:/send/i})).toBeNull();
});
it('keeps the edited amount on conflict and asks for refresh',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Another staff member changed this follow-up. Refresh before saving again.'},{status:409})));
 render(<FollowupControls item={item} onSaved={()=>{}}/>);fireEvent.change(screen.getByLabelText('Discount offered (NZD)'),{target:{value:'250'}});fireEvent.click(screen.getByRole('button',{name:'Save discount draft'}));
 expect(await screen.findByRole('alert')).toBeTruthy();expect((screen.getByLabelText('Discount offered (NZD)') as HTMLInputElement).value).toBe('250');
 expect((screen.getByRole('button',{name:'Save discount draft'}) as HTMLButtonElement).matches(':disabled')).toBe(true);
});
it('shows historical discount and its evidence independently of the draft',()=>{
 render(<FollowupControls item={{...item,controls:{...item.controls,state:{...emptyControls(),draftDiscountCents:90000,offers:[{number:1,sentAt:'2026-05-01T00:00:00Z',discountCents:50000,channel:'sms',source:'staff_recorded',evidence:'Phone sent folder'}]}}}} onSaved={()=>{}}/>);
 expect(screen.getByText(/First approach/)).toBeTruthy();expect(screen.getByText(/500.00/)).toBeTruthy();expect(screen.getByText('Phone sent folder')).toBeTruthy();expect((screen.getByLabelText('Discount offered (NZD)') as HTMLInputElement).value).toBe('900.00');
});
it('requires refresh after an uncertain network failure rather than retrying blindly',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('Connection lost');}));render(<FollowupControls item={item} onSaved={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Discount offered (NZD)'),{target:{value:'250'}});fireEvent.click(screen.getByRole('button',{name:'Save discount draft'}));
 await screen.findByRole('alert');expect((screen.getByRole('button',{name:'Save discount draft'}) as HTMLButtonElement).matches(':disabled')).toBe(true);
});
it('re-review preserves the saved NZ Dead date instead of reverting to an older note suggestion',()=>{
 render(<FollowupControls item={{...item,suggestion:{date:'2026-01-29',at:'2026-01-29T10:59:59.999Z',provenance:'note',evidence:'Old note'},controls:{...item.controls,state:{...emptyControls(),deadDate:'2026-09-01T11:59:59.999Z',dateEvidence:'Corrected current Dead episode',reviewedVersion:'older-version'}}}} onSaved={()=>{}}/>);
 expect((screen.getByLabelText('Estimated date this quote entered Dead') as HTMLInputElement).value).toBe('2026-09-01');
 expect((screen.getByLabelText('Date evidence') as HTMLTextAreaElement).value).toBe('Corrected current Dead episode');
});
it('shows the automatic date and reviews offers without requiring a replacement date',async()=>{
 const automatic={...item,job:{...item.job,deadEntry:{at:'2026-03-01T10:59:59Z',source:'last_note' as const,evidence:'01/03/26 - Called'}}};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({record:item.controls})));
 render(<FollowupControls item={automatic} onSaved={()=>{}}/>);
 expect(screen.getByText(/Assumed from last dated note/)).toBeTruthy();
 expect(screen.queryByLabelText('Estimated date this quote entered Dead')).toBeNull();
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save reviewed history'}));
 expect(await screen.findByRole('status')).toBeTruthy();
});

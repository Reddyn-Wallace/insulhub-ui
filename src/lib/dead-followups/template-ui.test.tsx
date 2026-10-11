// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import TemplateEditor from '@/app/jobs/settings/templates/TemplateEditor';
import SettingsPage from '@/app/jobs/settings/page';
import FollowupTemplates from '@/app/jobs/settings/templates/follow-ups/page';
import LegacyFollowupTemplates from '@/app/jobs/follow-ups/templates/page';
import {defaultTemplates,type TemplateRecord} from './templates';
const navigation=vi.hoisted(()=>({push:vi.fn(),replace:vi.fn(),redirect:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>navigation,redirect:navigation.redirect}));
let record:TemplateRecord;
let canManage:boolean;
const ordinary={id:'ordinary',title:'Lead follow-up',channel:'sms',description:'A normal template',subject:'',body:'Hi {first name}',sortOrder:10};
beforeEach(()=>{
 window.history.replaceState(null,'','/jobs/settings');
 vi.clearAllMocks();canManage=true;
 record={revision:2,templates:defaultTemplates(),actorName:'Admin',updatedAt:null};
 record.templates[0].body='Saved first offer {{discount}} for {{name}}';
 vi.stubGlobal('localStorage',{getItem:()=> 'token'});
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/contact-templates')return Response.json({templates:[ordinary]});
  if(url==='/api/dead-followups/templates'){
   if(init?.method==='PATCH'){
    const input=JSON.parse(String(init.body));
    if(input.revision!==record.revision)return Response.json({error:'Templates changed. Reload before saving.'},{status:409});
    record={...record,revision:record.revision+1,templates:input.templates};
   }
   return Response.json({record,events:[],canManage});
  }
  throw Error('Unexpected request '+url);
 }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('lists the saved first and second offers within each channel alongside normal templates',async()=>{
 render(<SettingsPage/>);
 const first=await screen.findByText('Quote follow-up — first offer');
 expect(screen.getByText('Lead follow-up')).toBeTruthy();
 expect(screen.getByText('Quote follow-up — second offer')).toBeTruthy();
 const row=first.parentElement!.parentElement!;
 expect(within(row).getByRole('link',{name:'Edit'}).getAttribute('href')).toBe('/jobs/settings/templates/quote-followup-sms-1');
 expect(within(row).queryByRole('button',{name:'Delete'})).toBeNull();
 expect(screen.queryByRole('link',{name:/Dead quote follow-up templates/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Email',exact:true}));
 expect(screen.getAllByRole('link',{name:'Edit'}).map(x=>x.getAttribute('href'))).toEqual(['/jobs/settings/templates/quote-followup-email-1','/jobs/settings/templates/quote-followup-email-2']);
 fireEvent.click(screen.getByRole('button',{name:'Calendar',exact:true}));
 expect(screen.queryByText('Quote follow-up — first offer')).toBeNull();
});
it('keeps normal templates usable and reports unavailable follow-up templates',async()=>{
 const fetcher=fetch;vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>url==='/api/dead-followups/templates'?Promise.resolve(Response.json({error:'Storage unavailable'},{status:503})):fetcher(url,init)));
 render(<SettingsPage/>);await screen.findByText('Lead follow-up');expect(await screen.findByRole('alert')).toBeTruthy();
});
it.each(['sms','email'] as const)('edits only the chosen %s offer through the shared editor and keeps all other offers',async channel=>{
 const before=structuredClone(record.templates);
 render(<TemplateEditor templateId={`quote-followup-${channel}-2`}/>);
 const body=await screen.findByLabelText('Message');
 fireEvent.change(body,{target:{value:'Updated {{name}} discount {{discount}} quote {{quoteNumber}}'}});
 expect(screen.getByText('Updated Alex discount $500.00 quote 123')).toBeTruthy();
 if(channel==='email')fireEvent.change(screen.getByLabelText('Subject'),{target:{value:'Quote {{quoteNumber}}'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
 await waitFor(()=>expect(navigation.push).toHaveBeenCalledWith(`/jobs/settings?channel=${channel}`));
 expect(record.revision).toBe(3);
 for(const template of record.templates){
  if(template.channel===channel&&template.approach===2){expect(template.body).toBe('Updated {{name}} discount {{discount}} quote {{quoteNumber}}');if(channel==='email')expect(template.subject).toBe('Quote {{quoteNumber}}');}
  else expect(template).toEqual(before.find(t=>t.channel===template.channel&&t.approach===template.approach));
 }
 expect(screen.queryByRole('button',{name:'Delete'})).toBeNull();
});
it('preserves unsaved edits on conflict and requires reload',async()=>{
 render(<TemplateEditor templateId="quote-followup-sms-1"/>);
 const body=await screen.findByLabelText('Message');fireEvent.change(body,{target:{value:'Edited {{discount}}'}});
 record={...record,revision:3};
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await screen.findByRole('alert');
 expect((body as HTMLTextAreaElement).value).toBe('Edited {{discount}}');
 expect(screen.getByRole('button',{name:'Save Changes'}).matches(':disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Reload saved template'}));
 await screen.findByDisplayValue('Saved first offer {{discount}} for {{name}}');
 expect(screen.getByRole('button',{name:'Save Changes'}).matches(':disabled')).toBe(false);
});
it('read-only staff cannot edit or save shared defaults',async()=>{
 canManage=false;render(<TemplateEditor templateId="quote-followup-sms-1"/>);
 expect((await screen.findByLabelText('Message')).matches(':disabled')).toBe(true);
 expect(screen.getByRole('button',{name:'Save Changes'}).matches(':disabled')).toBe(true);
});
it('allows correction after validation rejects the message',async()=>{
 render(<TemplateEditor templateId="quote-followup-sms-1"/>);
 const body=await screen.findByLabelText('Message');fireEvent.change(body,{target:{value:'Missing amount'}});
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'Include {{discount}}'},{status:400}));
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await screen.findByRole('alert');
 expect((body as HTMLTextAreaElement).value).toBe('Missing amount');expect(body.matches(':disabled')).toBe(false);
});
it('does not allow saving when the saved template could not be loaded',async()=>{
 vi.mocked(fetch).mockRejectedValueOnce(Error('Offline'));
 render(<TemplateEditor templateId="quote-followup-email-1"/>);
 await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Save Changes'}).matches(':disabled')).toBe(true);
});
it('inserts supported offer fields and previews saved wording without altering the saved text',async()=>{
 render(<TemplateEditor templateId="quote-followup-sms-1"/>);
 const body=await screen.findByLabelText('Message') as HTMLTextAreaElement;
 expect(body.value).toBe('Saved first offer {{discount}} for {{name}}');
 expect(screen.getByText('Saved first offer $500.00 for Alex')).toBeTruthy();
 body.setSelectionRange(body.value.length,body.value.length);
 fireEvent.click(screen.getByRole('button',{name:'{{quoteNumber}}',exact:true}));
 expect(body.value).toBe('Saved first offer {{discount}} for {{name}}{{quoteNumber}}');
});
it('keeps normal template field insertion, preview and editing working',async()=>{
 render(<TemplateEditor templateId="ordinary"/>);
 const body=await screen.findByLabelText('Message') as HTMLTextAreaElement;
 expect(body.value).toBe('Hi {first name}');expect(screen.getByText('Hi Jane')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Delete'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'{address}',exact:true})).toBeTruthy();
});
it('redirects both former template pages to the shared SMS list',()=>{
 render(<FollowupTemplates/>);render(<LegacyFollowupTemplates/>);
 expect(navigation.redirect.mock.calls).toEqual([['/jobs/settings?channel=sms'],['/jobs/settings?channel=sms']]);
});
it('locks an uncertain save and retains the draft until the user reloads',async()=>{
 render(<TemplateEditor templateId="quote-followup-email-2"/>);
 const body=await screen.findByLabelText('Message');fireEvent.change(body,{target:{value:'Keep this draft {{discount}}'}});
 vi.mocked(fetch).mockRejectedValueOnce(Error('Connection lost'));
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await screen.findByRole('alert');
 expect((body as HTMLTextAreaElement).value).toBe('Keep this draft {{discount}}');
 expect(screen.getByRole('button',{name:'Save Changes'}).matches(':disabled')).toBe(true);
 expect(navigation.push).not.toHaveBeenCalled();
});
it('shows the selected offer history in the shared editor',async()=>{
 const prior=structuredClone(record.templates);prior[0].body='Earlier SMS offer {{discount}}';prior[2].body='Different email offer {{discount}}';
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({record,canManage:true,events:[{revision:1,actorName:'Earlier Admin',createdAt:'2026-10-01T00:00:00Z',templates:prior}]}));
 render(<TemplateEditor templateId="quote-followup-sms-1"/>);await screen.findByLabelText('Message');
 fireEvent.click(screen.getByText('Template change history'));
 expect(screen.getByText('Earlier SMS offer {{discount}}')).toBeTruthy();
 expect(screen.queryByText('Different email offer {{discount}}')).toBeNull();
});
it('saves a normal template through its existing endpoint',async()=>{
 render(<TemplateEditor templateId="ordinary"/>);
 fireEvent.change(await screen.findByLabelText('Message'),{target:{value:'Hi {first name}, updated'}});
 vi.mocked(fetch).mockImplementationOnce(async(url,init)=>{
  expect(url).toBe('/api/contact-templates/ordinary');expect(init?.method).toBe('PATCH');
  const input=JSON.parse(String(init?.body));expect(input.body).toBe('Hi {first name}, updated');
  return Response.json({template:{...ordinary,...input}});
 });
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
 await waitFor(()=>expect(navigation.push).toHaveBeenCalledWith('/jobs/settings?channel=sms'));
 expect(record.revision).toBe(2);
});

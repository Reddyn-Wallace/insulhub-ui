// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import TemplateEditor from '@/app/jobs/settings/templates/TemplateEditor';
import SettingsPage from '@/app/jobs/settings/page';
import FollowupTemplates from '@/app/jobs/settings/templates/follow-ups/page';
import LegacyFollowupTemplates from '@/app/jobs/follow-ups/templates/page';
const navigation=vi.hoisted(()=>({push:vi.fn(),replace:vi.fn(),redirect:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>navigation,redirect:navigation.redirect}));
const dialog=vi.hoisted(()=>({confirm:vi.fn()}));
vi.mock('@/components/AppDialog',()=>({useAppDialog:()=>({confirm:dialog.confirm,dialog:null})}));
const first={id:'11111111-1111-4111-8111-111111111111',title:'Quote follow-up — first offer',channel:'sms',description:'',subject:'',body:'Hi {first name}, from {salesperson}.',sortOrder:10};
const second={...first,id:'22222222-2222-4222-8222-222222222222',title:'My own email',channel:'email',subject:'Quote {quote number}'};
let templates:typeof first[];
beforeEach(()=>{
 window.history.replaceState(null,'','/jobs/settings');vi.clearAllMocks();dialog.confirm.mockResolvedValue(true);templates=[{...first},{...second}];
 vi.stubGlobal('localStorage',{getItem:()=> 'token'});
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url==='/api/contact-templates')return Response.json({templates});
  const id=url.split('/').at(-1);const index=templates.findIndex(t=>t.id===id);
  if(index>=0&&init?.method==='DELETE'){templates.splice(index,1);return Response.json({ok:true});}
  if(index>=0&&init?.method==='PATCH'){templates[index]={...templates[index],...JSON.parse(String(init.body))};return Response.json({template:templates[index]});}
  throw Error('Unexpected request '+url);
 }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('lists and deletes imported follow-up templates exactly like other templates',async()=>{
 render(<SettingsPage/>);const title=await screen.findByText(first.title);const row=title.parentElement!.parentElement!;
 expect(within(row).getByRole('link',{name:'Edit'}).getAttribute('href')).toBe(`/jobs/settings/templates/${first.id}`);
 fireEvent.click(within(row).getByRole('button',{name:'Delete'}));await waitFor(()=>expect(screen.queryByText(first.title)).toBeNull());
 expect(templates.map(t=>t.id)).toEqual([second.id]);
 fireEvent.click(screen.getByRole('button',{name:'Email',exact:true}));expect(screen.getByText('My own email')).toBeTruthy();
});
it('lets an imported template be renamed, moved to email and saved without a discount tag',async()=>{
 render(<TemplateEditor templateId={first.id}/>);await screen.findByLabelText('Message');
 fireEvent.change(screen.getByLabelText('Template Name'),{target:{value:'My follow-up'}});
 fireEvent.click(screen.getByRole('button',{name:'Email',exact:true}));
 fireEvent.change(screen.getByLabelText('Subject'),{target:{value:'Checking in {first name}'}});
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Hi {first name}, do you have any questions?'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));await waitFor(()=>expect(navigation.push).toHaveBeenCalledWith('/jobs/settings?channel=email'));
 expect(templates[0]).toMatchObject({title:'My follow-up',channel:'email',body:'Hi {first name}, do you have any questions?'});
});
it.each([first,second])('provides the same merge fields and deletion for $title',async template=>{
 render(<TemplateEditor templateId={template.id}/>);const body=await screen.findByLabelText('Message') as HTMLTextAreaElement;
 for(const name of ['{customer name}','{first name}','{salesperson}','{salesperson first name}','{address}','{quote booking date}','{install date}','{install time}','{job number}','{phone}','{email}','{discount}','{quote number}'])expect(screen.getByRole('button',{name,exact:true})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'{{discount}}',exact:true})).toBeNull();
 body.setSelectionRange(body.value.length,body.value.length);fireEvent.click(screen.getByRole('button',{name:'{address}',exact:true}));expect(body.value).toContain('{address}');
 fireEvent.click(screen.getByRole('button',{name:'Delete'}));await waitFor(()=>expect(navigation.push).toHaveBeenCalledWith(`/jobs/settings?channel=${template.channel}`));
 expect(templates.some(t=>t.id===template.id)).toBe(false);
});
it('does not allow saving when a template could not be loaded',async()=>{
 vi.mocked(fetch).mockRejectedValueOnce(Error('Offline'));render(<TemplateEditor templateId={first.id}/>);
 await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Save Changes'}).matches(':disabled')).toBe(true);
});
it('redirects both former template pages to the ordinary list',()=>{
 render(<FollowupTemplates/>);render(<LegacyFollowupTemplates/>);expect(navigation.redirect.mock.calls).toEqual([['/jobs/settings?channel=sms'],['/jobs/settings?channel=sms']]);
});

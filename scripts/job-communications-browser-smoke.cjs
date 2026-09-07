/* eslint-disable @typescript-eslint/no-require-imports */
// Local production-build check. Every business API is simulated; no messages are sent.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
 const base=process.env.COMMUNICATIONS_SMOKE_BASE_URL || 'http://localhost:3114';
 if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Local preview only');
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {for(const width of [390,1280]) {
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const id='abcdefabcdefabcdefabcdef';let enabled=true;let historyFailures=1;let checks=0;let smsStatus='accepted';
  const job={_id:id,jobNumber:99999,stage:'LEAD',lead:{leadStatus:'NEW'},client:{contactDetails:{name:'Sophie Turner',phoneMobile:'0211234567',email:'sophie@example.test',streetAddress:'14 Kauri Street'}},notes:''};
  const records=()=>[
   {id:'11111111-1111-4111-8111-111111111111',source:'crm_sms',channel:'sms',senderName:'Business mobile',senderValue:'+64273623220',actorName:'Reddyn Wallace',destination:'+64211234567',renderedBody:'Hi Sophie, we’ll arrive between 9 and 10 tomorrow. Please leave the driveway clear for the team.',status:smsStatus,sentAt:'2026-09-07T03:00:00Z'},
   {id:'22222222-2222-4222-8222-222222222222',source:'crm_email',channel:'email',senderName:'Reddyn Wallace (Insulmax)',senderValue:'reddyn@example.test',actorName:'Reddyn Wallace',destination:'sophie@example.test',renderedSubject:'Your installation is confirmed',renderedBody:'Hi Sophie,\nYour installation is confirmed for Thursday.\nKind regards,\nReddyn Wallace\nInsulmax',renderedHtml:'<p>Hi Sophie,</p><p>Your installation is confirmed for Thursday. We’ll be in touch before the team arrives.</p><p>Kind regards,<br><b>Reddyn Wallace</b><br>Insulmax · Wellington</p>',status:'sent',sentAt:'2026-09-06T02:00:00Z'},
   {id:'33333333-3333-4333-8333-333333333333',source:'campaign',channel:'email',campaignName:'Winter follow-up',senderName:'Wellington team',actorName:'Andrew Potter',destination:'sophie@example.test',renderedSubject:'A warmer home this winter',renderedBody:'Just checking whether you had any questions about your insulation quote.',status:'sent',sentAt:'2026-09-05T02:00:00Z'},
   {id:'44444444-4444-4444-8444-444444444444',source:'job',channel:'sms',destination:'+64211234567',renderedBody:'Manual SMS draft',status:'launched',sentAt:'2026-09-04T02:00:00Z'},
  ];
  await context.addInitScript(()=>{if(window!==window.top)return;localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'tester',firstname:'Reddyn',lastname:'Wallace',role:'ADMIN'}));});
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname==='/graphql')return json({data:{job,me:{_id:'tester'},users:{results:[]},jobs:{results:[],total:0}}});
   if(url.origin!==base || url.pathname==='/sw.js')return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/settings/partners/job-status')return json({jobs:[]});
   if(req.method()==='POST'){
    assert.equal(url.pathname,`/api/jobs/${id}/sms`);assert.equal(req.postDataJSON().action,'check','History must never submit a send');checks++;smsStatus='delivered';return json({message:{id:records()[0].id,status:smsStatus}});
   }
   if(url.pathname.endsWith('/campaign-communications') && historyFailures-- > 0)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary outage'})});
   if(url.pathname.endsWith('/campaign-communications'))return json({communications:records(),crmMessagingEnabled:enabled});
   if(url.pathname.endsWith('/sms')||url.pathname.endsWith('/email'))return json({enabled,senders:[],message:null});
   if(url.pathname==='/api/contact-templates')return json({templates:[]});
   if(url.pathname==='/api/site-plan-drawings')return json({drawings:[]});
   return json({rows:[],planning:[],settings:{},senders:[]});
  });
  await page.goto(`${base}/jobs/${id}`);
  await expect(page.getByRole('alert').filter({hasText:/Could not/})).toContainText(/Could not/);
  await page.getByRole('button',{name:'Try again'}).click();
  const section=page.getByRole('region',{name:'Job communications'});await expect(section).toBeVisible();
  await expect(section.getByRole('list',{name:'CRM-sent messages'}).getByRole('listitem')).toHaveCount(3);
  await expect(section.getByRole('status').filter({hasText:'Delivered'})).toBeVisible();assert.ok(checks>0);
  await section.getByRole('button',{name:/^Email/}).click();await expect(section.getByRole('list',{name:'CRM-sent messages'}).getByRole('listitem')).toHaveCount(2);
  await section.getByRole('button',{name:/Your installation is confirmed/}).click();
  await expect(section.frameLocator('iframe').getByText('Insulmax · Wellington')).toBeVisible();
  await section.screenshot({path:`/tmp/insulhub-job-communications-${width}.png`});
  await section.getByRole('searchbox').fill('Andrew Potter');await expect(section.getByText('A warmer home this winter')).toBeVisible();await expect(section.getByText('Your installation is confirmed')).toHaveCount(0);
  await section.getByRole('searchbox').fill('not present');await expect(section.getByText('No messages match your filters.')).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow');
  enabled=false;await page.reload();await expect(page.getByRole('heading',{name:'Sent Communications'})).toBeVisible();await expect(page.getByRole('region',{name:'Job communications'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'💬 Text',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'✉️ Email',exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);console.log(`${width}px: saved history, original signature, filters/search, automatic SMS status, flag-off legacy UI and manual options passed; no sends`);
  await context.close();
 }} finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

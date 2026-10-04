/* eslint-disable @typescript-eslint/no-require-imports */
// Local preview only; every business request is simulated, no messages/customer writes.
const {chromium,expect}=require('@playwright/test');
const base=process.env.DEAD_FOLLOWUPS_SMOKE_URL || 'http://localhost:3116';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Local preview only');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'test-staff',firstname:'Test',lastname:'Staff',role:'ADMIN'}));});
  const job={_id:'aaaaaaaaaaaaaaaaaaaaaaaa',jobNumber:123,stage:'QUOTE',updatedAt:'2026-09-01T00:00:00Z',notes:'29/01/26 - Marked as Dead: timing did not suit - Staff',quote:{status:'DECLINED',c_total:12500,date:'2026-01-01T00:00:00Z',wall:{SQM:90},ceiling:{SQM:50}},client:{contactDetails:{name:'Alex Example',streetAddress:'12 Test Street',city:'Wellington'}}};
  let record={revision:0,state:{draftDiscountCents:null,snoozedUntil:null,exclusionReason:null,deadDate:null,dateEvidence:'',reviewedVersion:null,offers:[]},updatedAt:null,actorName:''};const events=[];let mutationCount=0;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/dead-followups')return route.fulfill({json:{readOnly:false,historyAvailable:true,checkedAt:new Date().toISOString(),items:[{job,controls:record,suggestion:null,earliestFirstApproach:null,eligibility:{state:record.state.exclusionReason?'excluded':'review',reason:'Review date and history'}}]}});
   if(url.pathname.endsWith('/dead-followup')){
    if(route.request().method()==='GET')return route.fulfill({json:{job,record,events,readOnly:false}});
    const body=route.request().postDataJSON();if(body.revision!==record.revision || body.jobVersion!==job.updatedAt)throw Error('Incorrect revision guard');
    const command=body.command;const state=structuredClone(record.state);mutationCount++;
    if(command.action==='discount')state.draftDiscountCents=Math.round(Number(command.amount)*100);
    else if(command.action==='snooze')state.snoozedUntil=`${command.date}T10:59:59.999Z`;
    else if(command.action==='exclude')state.exclusionReason=command.reason;
    else if(command.action==='restore')state.exclusionReason=null;
    else if(command.action==='record_offer')state.offers.push({number:1,sentAt:`${command.date}T10:59:59.999Z`,discountCents:Math.round(Number(command.amount)*100),channel:command.channel,source:'staff_recorded',evidence:command.evidence});
    else throw Error(`Unexpected mutation ${command.action}`);
    record={revision:record.revision+1,state,updatedAt:new Date().toISOString(),actorName:'Test Staff'};
    events.unshift({revision:record.revision,state:structuredClone(state),actorName:'Test Staff',createdAt:record.updatedAt,action:command.action,reason:command.reason || ''});
    return route.fulfill({json:{record}});
   }
   if(url.pathname==='/graphql')return route.fulfill({json:{data:{me:{_id:'test-staff'},users:{results:[]},jobs:{results:[],total:0}}}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
   if(url.origin!==base)return route.abort();return route.continue();
  });
  await page.goto(`${base}/jobs/follow-ups?stage=QUOTE`);await page.getByRole('button',{name:/Alex Example/}).click();
  await page.getByLabel('Discount offered (NZD)',{exact:true}).fill('500');await page.getByRole('button',{name:'Save discount draft'}).click();
  await expect(page.getByText(/Last changed by Test Staff/)).toBeVisible();await expect(page.getByLabel('Discount offered (NZD)',{exact:true})).toHaveValue('500.00');
  await page.getByText('Record an earlier offer',{exact:true}).click();await page.getByLabel('Historical discount (NZD)').fill('250');await page.getByLabel('Date sent',{exact:true}).fill('2026-05-15');await page.getByLabel('Evidence of sending').fill('Checked the company phone sent folder.');await page.getByRole('button',{name:'Record historical offer'}).click();await expect(page.getByText(/First approach.*250.00/)).toBeVisible();
  await page.getByRole('button',{name:'1 week',exact:true}).click();await expect(page.getByRole('button',{name:/Alex Example/})).toHaveCount(0);await page.goto(base+'/jobs/'+job._id+'/follow-up-history');await expect(page.getByText(/Snoozed through/)).toBeVisible();
  await page.getByText('Exclude from individual follow-ups',{exact:true}).click();await page.getByLabel('Exclusion reason').fill('Not suitable for another individual approach');await page.getByRole('button',{name:'Exclude follow-ups',exact:true}).click();await expect(page.getByRole('button',{name:'Restore follow-ups'})).toBeVisible();
  await page.getByRole('button',{name:'Restore follow-ups'}).click();await expect(page.getByText('Exclude from individual follow-ups',{exact:true})).toBeVisible();

  record.state.snoozedUntil=null;await page.goto(base+'/jobs/follow-ups');await page.getByRole('button',{name:/Alex Example/}).click();await page.getByRole('button',{name:'Skip for now'}).click();await expect(page.getByRole('button',{name:/Alex Example/})).toHaveCount(0);await page.getByRole('button',{name:'Undo skip'}).click();await page.getByRole('button',{name:/Alex Example/}).click();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');
  await expect(page.getByRole('button',{name:/send/i})).toHaveCount(0);if(errors.length)throw Error(errors.join('\n'));if(mutationCount!==5)throw Error(`Unexpected mutation count: ${mutationCount}`);
  await page.screenshot({path:`/tmp/dead-followup-controls-${width}.png`,fullPage:true});
  console.log(`PASS ${width}px: draft, historical offer, snooze, exclude/restore, skip/undo, no sending or layout errors`);await context.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

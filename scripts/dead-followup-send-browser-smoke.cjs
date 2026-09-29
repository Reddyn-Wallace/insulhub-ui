/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium,expect}=require('@playwright/test');
const base=process.env.DEAD_FOLLOWUPS_SMOKE_URL||'http://localhost:3116';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Local preview only');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280])for(const channel of ['sms','email']){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'staff',firstname:'Test',lastname:'Staff',role:'ADMIN'}));});
  const job={_id:'aaaaaaaaaaaaaaaaaaaaaaaa',jobNumber:123,stage:'QUOTE',updatedAt:'2026-09-01T00:00:00Z',quote:{status:'DECLINED',c_total:12500,date:'2025-12-01T00:00:00Z'},client:{contactDetails:{name:'Alex Example',streetAddress:'12 Test Street'}}};
  const controls={revision:1,state:{draftDiscountCents:50000,snoozedUntil:null,exclusionReason:null,deadDate:'2026-01-01T00:00:00Z',dateEvidence:'Reviewed notes',reviewedVersion:job.updatedAt,offers:[]},actorName:'Test Staff',updatedAt:null};
  let saved=null;let sends=0;let notes=0;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/dead-followups')return route.fulfill({json:{readOnly:false,historyAvailable:true,checkedAt:new Date().toISOString(),items:[{job,controls,suggestion:null,earliestFirstApproach:null,eligibility:{state:'due',approach:1,reason:'Due'},sendAvailable:true,sendEnabled:true}]}});
   if(url.pathname.endsWith('/dead-followup/send')){
    if(route.request().method()==='GET')return route.fulfill({json:{enabled:true,attempts:saved?[saved]:[],contact:{phoneMobile:'0211234567',email:'example@example.test'},sms:{senders:channel==='sms'?[{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',label:'Work phone'}]:[]},email:{senders:channel==='email'?[{id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',label:'Work email'}]:[]}}});
    const input=route.request().postDataJSON();
    if(input.action==='send'){sends++;if(input.channel!==channel||!input.body.includes('$500.00'))throw Error('Wrong send snapshot');saved={id:'cccccccc-cccc-4ccc-cccc-cccccccccccc',channel,approach:1,status:channel==='sms'?'accepted':'sent',noteStatus:'pending',discountCents:50000,body:input.body,destination:input.destination};if(channel==='sms')return route.abort();}
    else if(input.action==='check'){saved.status='sent';}
    else if(input.action==='note'){notes++;saved.noteStatus='saved';}
    else throw Error('Unexpected action');
    return route.fulfill({json:{attempt:saved,noteError:saved.status==='sent'&&saved.noteStatus==='pending'?'Offer sent. Job note pending.':''}});
   }
   if(url.pathname==='/graphql')return route.fulfill({json:{data:{me:{_id:'staff'},users:{results:[]},jobs:{results:[],total:0}}}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
   if(url.origin!==base)return route.abort();return route.continue();
  });
  await page.goto(base+'/jobs/follow-ups?stage=QUOTE');await page.getByRole('button',{name:/Alex Example/}).click();await page.getByRole('button',{name:'Compose or check follow-up'}).click();
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue(/\$500\.00/);await expect(page.getByRole('button',{name:'Send offer',exact:true})).toBeDisabled();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Hi Alex, we can offer a discount of $500.00. Would you like to revisit your quote?');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Send offer',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`/tmp/dead-followup-compose-${channel}-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Send offer',exact:true}).click();
  if(channel==='sms'){await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Send offer',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Compose or check follow-up'}).click();await page.getByRole('button',{name:'Check saved send status'}).click();}
  await page.getByRole('button',{name:'Retry job note only'}).click();await expect(page.getByText('Job note: saved',{exact:true})).toBeVisible();
  if(sends!==1||notes!==1)throw Error('Unexpected dispatch or note count');
  // Recovery remains available after leaving the Dead queue.
  saved.noteStatus='pending';await page.goto(base+'/jobs/'+job._id+'/follow-up-history');await page.getByRole('button',{name:'Compose or check follow-up'}).click();await expect(page.getByRole('button',{name:'Retry job note only'})).toBeVisible();await expect(page.getByRole('button',{name:'Send offer',exact:true})).toHaveCount(0);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');
  if(errors.length)throw Error(errors.join('\n'));console.log(`PASS ${channel} ${width}px: edited offer, explicit review, one dispatch, note-only recovery, history outside Dead`);await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

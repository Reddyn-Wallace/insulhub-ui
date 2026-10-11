/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium,expect}=require('@playwright/test');
const base=process.env.DEAD_FOLLOWUPS_SMOKE_URL||'http://localhost:3116';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Local preview only');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{delete Navigator.prototype.serviceWorker;localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'staff',firstname:'Test',lastname:'Staff',role:'ADMIN'}));});
  let templates=['sms','email'].flatMap((channel,c)=>[1,2].map(approach=>({id:`${c+1}${approach}111111-1111-4111-8111-111111111111`,title:`Quote follow-up — ${approach===1?'first':'second'} offer`,channel,description:'Quote follow-up',sortOrder:approach,subject:channel==='email'?'Quote {quote number}':'',body:'Hi {customer name}, offer {discount}.'})));let writes=0;
  let attempt={id:'cccccccc-cccc-4ccc-cccc-cccccccccccc',actorId:'staff',actorName:'Test Staff',createdAt:'2026-01-01T00:00:00Z',approach:1,channel:'email',body:'An earlier offer $500.00',destination:'alex@example.test',discountCents:50000,status:'unknown',noteStatus:'pending',canVerify:true};let verificationCount=0;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/contact-templates')return route.fulfill({json:{templates}});
   if(url.pathname.startsWith('/api/contact-templates/')){
    const id=url.pathname.split('/').at(-1);const index=templates.findIndex(t=>t.id===id);if(index<0)return route.fulfill({status:404,json:{error:'Not found'}});
    if(route.request().method()==='PATCH'){templates[index]={...templates[index],...route.request().postDataJSON()};writes++;return route.fulfill({json:{template:templates[index]}});}
    if(route.request().method()==='DELETE'){templates.splice(index,1);writes++;return route.fulfill({json:{ok:true}});}
   }
   if(url.pathname.endsWith('/dead-followup/send')){
    if(route.request().method()==='POST'){const input=route.request().postDataJSON();if(input.action!=='verify'||input.confirmed!==true||input.evidence.length<20)throw Error('Unexpected action — must verify, never send');verificationCount++;attempt={...attempt,status:'sent',noteStatus:'saved',canVerify:false,sentAt:new Date().toISOString(),verification:{actorName:'Test Staff',evidence:input.evidence}};return route.fulfill({json:{attempt,noteError:''}});}
    return route.fulfill({json:{enabled:false,attempts:[attempt],contact:{},sms:{senders:[]},email:{senders:[]},templates}});
   }
   if(url.pathname==='/graphql')return route.fulfill({json:{data:{me:{_id:'staff'},users:{results:[]},jobs:{results:[],total:0}}}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
   if(url.origin!==base)return route.abort();return route.continue();
  });
  await page.goto(base+'/jobs/settings/templates/follow-ups');await expect(page).toHaveURL(base+'/jobs/settings?channel=sms');await page.locator('a[href="/jobs/settings/templates/11111111-1111-4111-8111-111111111111"]').click();const body=page.getByRole('textbox',{name:'Message',exact:true});await expect(body).toBeVisible();await body.fill('Hi {first name}, updated offer {discount} for quote {quote number}.');
  await expect(page.getByText('Hi Jane, updated offer $500.00 for quote Q1234.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Save Changes'}).click();await expect(page).toHaveURL(base+'/jobs/settings?channel=sms');await page.locator('a[href="/jobs/settings/templates/11111111-1111-4111-8111-111111111111"]').click();await expect(body).toHaveValue('Hi {first name}, updated offer {discount} for quote {quote number}.');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/dead-followup-templates-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();await expect(page).toHaveURL(base+'/jobs/settings?channel=sms');await page.reload();await expect(page.getByText('Quote follow-up — second offer',{exact:true})).toBeVisible();await expect(page.getByText('Quote follow-up — first offer',{exact:true})).toHaveCount(0);if(writes!==2)throw Error('Unexpected template mutation count');
  await page.goto(base+'/jobs/aaaaaaaaaaaaaaaaaaaaaaaa/follow-up-history');await page.getByRole('button',{name:'Compose or check follow-up'}).click();await page.getByText('Verify from sent evidence',{exact:true}).click();
  await page.getByLabel('Where you verified this send').fill('Checked Gmail Sent folder; exact recipient, date, content and $500 discount match.');await page.getByLabel('I found this exact message in the sending account or device as sent.').check();await page.getByRole('button',{name:'Record verified send'}).click();await expect(page.getByText(/Sent verified by Test Staff/)).toBeVisible();await expect(page.getByText('Job note: saved',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Send offer',exact:true})).toHaveCount(0);
  if(verificationCount!==1)throw Error('Verification repeated');if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');if(errors.length)throw Error(errors.join('\n'));
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/dead-followup-verification-${width}.png`,fullPage:true});
  console.log(`PASS ${width}px: shared template editing/preview/persistence, deletable ordinary templates, positive-evidence recovery with sending disabled`);await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

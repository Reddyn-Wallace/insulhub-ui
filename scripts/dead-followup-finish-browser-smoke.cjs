/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium,expect}=require('@playwright/test');
const base=process.env.DEAD_FOLLOWUPS_SMOKE_URL||'http://localhost:3116';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Local preview only');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'staff',firstname:'Test',lastname:'Staff',role:'ADMIN'}));});
  let templates=['sms','email'].flatMap(channel=>[1,2].map(approach=>({channel,approach,subject:channel==='email'?'Quote {{quoteNumber}}':'',body:'Hi {{name}}, offer {{discount}}.'})));let revision=0;let canManage=true;let writes=0;
  let attempt={id:'cccccccc-cccc-4ccc-cccc-cccccccccccc',actorId:'staff',actorName:'Test Staff',createdAt:'2026-01-01T00:00:00Z',approach:1,channel:'email',body:'An earlier offer $500.00',destination:'alex@example.test',discountCents:50000,status:'unknown',noteStatus:'pending',canVerify:true};let verificationCount=0;
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/dead-followups/templates'){
    if(route.request().method()==='PATCH'){const input=route.request().postDataJSON();if(!canManage||input.revision!==revision)throw Error('Invalid shared update');templates=input.templates;revision++;writes++;}
    return route.fulfill({json:{record:{revision,templates,actorName:'Test Admin',updatedAt:null},canManage,events:[]}});
   }
   if(url.pathname.endsWith('/dead-followup/send')){
    if(route.request().method()==='POST'){const input=route.request().postDataJSON();if(input.action!=='verify'||input.confirmed!==true||input.evidence.length<20)throw Error('Unexpected action — must verify, never send');verificationCount++;attempt={...attempt,status:'sent',noteStatus:'saved',canVerify:false,sentAt:new Date().toISOString(),verification:{actorName:'Test Staff',evidence:input.evidence}};return route.fulfill({json:{attempt,noteError:''}});}
    return route.fulfill({json:{enabled:false,attempts:[attempt],contact:{},sms:{senders:[]},email:{senders:[]},templates,templateRevision:revision}});
   }
   if(url.pathname==='/graphql')return route.fulfill({json:{data:{me:{_id:'staff'},users:{results:[]},jobs:{results:[],total:0}}}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
   if(url.origin!==base)return route.abort();return route.continue();
  });
  await page.goto(base+'/jobs/follow-ups/templates');await expect(page.getByRole('button',{name:'Quotes',exact:true})).toHaveCSS('background-color','rgb(232, 93, 4)');const body=page.getByRole('textbox',{name:'First SMS message',exact:true});await expect(body).toBeVisible();await body.fill('Hi {{name}}, updated offer {{discount}} for quote {{quoteNumber}}.');
  await expect(page.getByText('Hi Alex, updated offer $500.00 for quote 123.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Save shared templates'}).click();await expect(page.getByRole('status')).toContainText('Shared templates saved');await page.getByRole('button',{name:'Reload saved templates'}).click();await expect(body).toHaveValue('Hi {{name}}, updated offer {{discount}} for quote {{quoteNumber}}.');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/dead-followup-templates-${width}.png`,fullPage:true});
  canManage=false;await page.getByRole('button',{name:'Reload saved templates'}).click();await expect(page.getByRole('button',{name:'Save shared templates'})).toBeDisabled();if(writes!==1)throw Error('Unexpected template mutation count');
  await page.goto(base+'/jobs/aaaaaaaaaaaaaaaaaaaaaaaa/follow-up-history');await page.getByRole('button',{name:'Compose or check follow-up'}).click();await page.getByText('Verify from sent evidence',{exact:true}).click();
  await page.getByLabel('Where you verified this send').fill('Checked Gmail Sent folder; exact recipient, date, content and $500 discount match.');await page.getByLabel('I found this exact message in the sending account or device as sent.').check();await page.getByRole('button',{name:'Record verified send'}).click();await expect(page.getByText(/Sent verified by Test Staff/)).toBeVisible();await expect(page.getByText('Job note: saved',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Send offer',exact:true})).toHaveCount(0);
  if(verificationCount!==1)throw Error('Verification repeated');if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');if(errors.length)throw Error(errors.join('\n'));
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/dead-followup-verification-${width}.png`,fullPage:true});
  console.log(`PASS ${width}px: shared template editing/preview/persistence, read-only staff, positive-evidence recovery with sending disabled`);await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

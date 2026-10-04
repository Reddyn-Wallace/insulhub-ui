/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium,expect}=require('@playwright/test');
const base='http://127.0.0.1:3117';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});const page=await context.newPage();const errors=[];const external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==base)external.push(r.url());});
  await page.request.post(base+'/api/preview/reset');
  await page.goto(base+'/jobs/follow-ups?stage=QUOTE');await expect(page.getByText('Interactive preview · Sample quotes · Sends are simulated')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Show quotes'})).toHaveCount(0);await expect(page.getByRole('button',{name:/Taylor Demo/})).toHaveCount(0);await expect(page.getByRole('button',{name:'Needs review',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/Alex Example/}).click();
  await expect(page.getByText('Review the quote’s age, scope and pricing before making an offer.')).toHaveCount(0);
  await expect(page.getByText('Previous offers not yet reviewed',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Already discounted',{exact:true})).toHaveCount(1);await expect(page.getByText('Existing discount: $750 excl. GST')).toBeVisible();await expect(page.getByText(/Ceiling:/)).toHaveCount(0);
  await page.getByLabel('Discount offered (NZD)',{exact:true}).fill('650');await page.getByRole('button',{name:'Save discount draft'}).click();
  await expect(page.getByLabel('Discount offered (NZD)',{exact:true})).toHaveValue('650.00');
  await page.getByRole('button',{name:'Compose or check follow-up'}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue(/\$650\.00/);
  await page.getByRole('checkbox',{name:/I checked the recipient/}).check();await page.getByRole('button',{name:'Send offer',exact:true}).click();
  await expect(page.getByText('Offer sent. Discount saved in history and job notes.')).toBeVisible();await page.getByRole('button',{name:'Refresh quote and eligibility'}).click();
  await expect(page.getByRole('button',{name:/Alex Example/})).toHaveCount(0);
  const saved=await (await page.request.get(base+'/api/dead-followups')).json();const first=saved.items.find(x=>x.job.client.contactDetails.name==='Alex Example');if(!first.job.notes.includes('Discount offered: NZD $650.00')||first.controls.state.offers.length!==1)throw Error('Discount history/notes missing');
  await page.reload();await expect(page.getByRole('button',{name:/Alex Example/})).toHaveCount(0);
  await page.getByRole('button',{name:/Morgan Sample/}).click();await page.getByRole('button',{name:'Compose or check follow-up'}).click();await page.getByRole('combobox',{name:'Send by',exact:true}).selectOption('email');
  await page.getByRole('checkbox',{name:/I checked the recipient/}).check();await page.getByRole('button',{name:'Send offer',exact:true}).click();await expect(page.getByText('Offer sent. Discount saved in history and job notes.')).toBeVisible();
  await page.getByRole('link',{name:'Offer templates'}).click();const text=page.getByRole('textbox',{name:'First SMS message',exact:true});await text.fill('Hi {{name}}, a sample discount of {{discount}} for quote {{quoteNumber}}.');await page.getByRole('button',{name:'Save shared templates'}).click();await expect(page.getByRole('status')).toContainText('Shared templates saved');
  await page.request.post(base+'/api/preview/reset');await page.goto(base+'/jobs/follow-ups?stage=QUOTE');await page.getByRole('button',{name:/Alex Example/}).click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/followup-interactive-${width}.png`,fullPage:true});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');if(errors.length)throw Error(errors.join('\n'));if(external.length)throw Error('External requests: '+external.join('\n'));
  console.log(`PASS ${width}px: actual preview server, editable discounts, SMS/email simulation, notes/history/reload persistence, shared templates, no external requests`);
  await page.request.post(base+'/api/preview/reset');await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

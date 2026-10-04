/* eslint-disable @typescript-eslint/no-require-imports */
const {chromium,expect}=require('@playwright/test');
const base=process.env.DEAD_FOLLOWUPS_SMOKE_URL||'http://localhost:3116';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Local preview only');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'staff',firstname:'Test',lastname:'Staff',role:'ADMIN'}));});
  let source='last_note';let uncertain=false;let reviewed=false;let checks=0;
  let record={revision:0,state:{draftDiscountCents:50000,snoozedUntil:null,exclusionReason:null,deadDate:null,dateEvidence:'',reviewedVersion:null,offers:[]},updatedAt:null,actorName:''};
  const entry=()=>({at:'2026-03-01T10:59:59.999Z',source,evidence:source==='last_note'?'01/03/26 - Last customer note':'Server confirmed UI entry'});
  const job=()=>({_id:'aaaaaaaaaaaaaaaaaaaaaaaa',jobNumber:123,stage:'QUOTE',updatedAt:'2026-09-01T00:00:00Z',notes:'01/03/26 - Last customer note',quote:{status:'DECLINED',date:'2026-01-01',c_total:12000},client:{contactDetails:{name:'Alex Example'}},deadEntry:entry(),deadDateUncertain:uncertain});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/dead-followups')return route.fulfill({json:{readOnly:false,historyAvailable:true,checkedAt:'2026-10-04T00:00:00Z',items:[{job:job(),controls:record,suggestion:null,earliestFirstApproach:'2026-05-01',eligibility:{state:uncertain?'attention':reviewed?'due':'review',reason:'Review earlier offers',approach:reviewed?1:undefined,dueAt:reviewed?'2026-05-01T11:59:59.999Z':undefined}}]}});
   if(url.pathname.endsWith('/dead-followup')){
    const input=route.request().postDataJSON();if(input.command.action!=='review'||input.command.historyConfirmed!==true||input.command.date)throw Error('Unexpected review payload');reviewed=true;record={...record,revision:record.revision+1,state:{...record.state,deadDate:entry().at,reviewedVersion:job().updatedAt}};return route.fulfill({json:{record}});
   }
   if(url.pathname.endsWith('/dead-date/check')){checks++;uncertain=false;source='ui_recovery';return route.fulfill({json:{ok:true}});}
   if(url.pathname==='/graphql')return route.fulfill({json:{data:{me:{_id:'staff'},users:{results:[]},jobs:{results:[],total:0}}}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
   if(url.origin!==base)return route.abort();return route.continue();
  });
  await page.goto(base+'/jobs/follow-ups?stage=QUOTE');await page.getByRole('button',{name:/Alex Example/}).click();
  await expect(page.getByText('Assumed from last dated note: 1 Mar 2026',{exact:true})).toBeVisible();
  await page.getByText('Review the Dead date and prior offers',{exact:true}).click();
  await expect(page.getByLabel('Estimated date this quote entered Dead')).toHaveCount(0);
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save reviewed history'}).click();
  await expect(page.getByText('Next eligible date: 1 May 2026',{exact:true})).toBeVisible();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`/tmp/dead-followup-dates-${width}.png`,fullPage:true});
  uncertain=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Check saved Dead date'}).click();
  await expect(page.getByText('Confirmed after an interrupted save: 1 Mar 2026',{exact:true})).toBeVisible();
  if(checks!==1)throw Error('Unexpected recovery calls');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');if(errors.length)throw Error(errors.join('\n'));
  console.log(`PASS ${width}px: assumed-date provenance, history-only review, interrupted-save recovery`);await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

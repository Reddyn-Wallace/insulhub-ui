// Local production preview only. All business requests are mocked; no customer data or sends.
const {chromium,expect}=require('@playwright/test');
const base=process.env.DEAD_FOLLOWUPS_SMOKE_URL || 'http://localhost:3116';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base))throw Error('Local preview only');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const width of [390,1280]){
      const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
      const page=await context.newPage();const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await context.addInitScript(()=>{localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'tester',firstname:'Test',lastname:'Staff',role:'ADMIN'}));});
      const quote={_id:'111111111111111111111111',jobNumber:123,stage:'QUOTE',notes:'29/01/26 - Marked as Dead: timing did not suit - Staff',quote:{status:'DECLINED',date:'2026-01-01T00:00:00Z',c_total:12500,wall:{SQM:90},ceiling:{SQM:50}},client:{contactDetails:{name:'Alex Example',streetAddress:'12 Test Street',city:'Wellington'}}};
      const items=[{job:quote,eligibility:{state:'review',reason:'Review previous offers before deciding the next approach.'},suggestion:{date:'2026-01-29',provenance:'note',evidence:quote.notes,at:'2026-01-29T10:59:59.999Z'},earliestFirstApproach:'2026-03-29T10:59:59.999Z'},{job:{...quote,_id:'222222222222222222222222',jobNumber:124,notes:'Customer not ready',client:{contactDetails:{name:'Taylor Example',streetAddress:'8 Sample Road'}}},eligibility:{state:'review',reason:'Review previous offers before deciding the next approach.'},suggestion:null,earliestFirstApproach:null}];
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.pathname==='/api/dead-followups')return route.fulfill({json:{items,checkedAt:'2026-09-29T00:00:00Z',readOnly:true,historyAvailable:false}});
        if(url.pathname==='/graphql')return route.fulfill({json:{data:{me:{_id:'tester'},users:{results:[]},jobs:{results:[],total:0}}}});
        if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
        if(url.origin!==base)return route.abort();
        return route.continue();
      });
      await page.goto(`${base}/jobs/follow-ups?stage=QUOTE`);
      await expect(page.getByRole('heading',{name:'Follow-ups',exact:true})).toBeVisible();
      await page.getByRole('button',{name:/Alex Example/}).click();
      await expect(page.getByText('Previous offers not yet reviewed')).toHaveCount(0);
      await expect(page.getByText('Estimated from a note — not confirmed')).toHaveCount(0);
      await expect(page.getByRole('button',{name:/send/i})).toHaveCount(0);
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Horizontal overflow');
      await page.screenshot({path:`/tmp/dead-followups-${width}.png`,fullPage:true});
      if(width<768)await page.getByRole('button',{name:'Back to quotes'}).click();
      await page.getByRole('button',{name:/Taylor Example/}).click();
      await expect(page.getByRole('heading',{name:'Dead entry date unknown'})).toHaveCount(0);
      if(errors.length)throw Error(errors.join('\n'));
      console.log(`PASS ${width}px: queue/detail navigation, evidence labels, no send controls, no overflow or page errors`);
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

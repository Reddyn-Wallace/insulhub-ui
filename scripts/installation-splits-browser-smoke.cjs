const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:"chrome"});
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:1000}});
   const page=await context.newPage();const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:3128/jobs/installation-splits-preview');
   await page.getByRole('button',{name:'Record completed work',exact:true}).click();
   await page.getByRole('tab',{name:'Usage report',exact:true}).click();
   let row=page.getByRole('row').filter({hasText:'DEMO-101'});
   await row.getByText('Estimated · quoted budget',{exact:true}).waitFor();
   assert.match(await row.innerText(),/18/);
   await page.getByRole('tab',{name:'Weekly calendar',exact:true}).click();
   await page.getByText('Week of 9 Nov',{exact:true}).waitFor();
   await page.getByRole('tab',{name:'Job & visits',exact:true}).click();
   await page.getByRole('button',{name:'Record completed work',exact:true}).click();
   await page.getByRole('button',{name:'Complete final checksheet',exact:true}).click();
   await page.getByRole('tab',{name:'Usage report',exact:true}).click();
   assert.equal(await page.getByText('Revised · allocated actual total',{exact:true}).count(),2);
   await page.getByRole('cell',{name:'19.2',exact:true}).waitFor();
   await page.getByRole('cell',{name:'12.8',exact:true}).waitFor();
   await page.getByLabel('Reporting week').selectOption('2026-11-09');
   assert.equal(await page.getByRole('row').filter({hasText:'DEMO-101'}).count(),1);
   await page.reload();
   await page.getByText('Final actual total: 32 bags.',{exact:false}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
   await page.screenshot({path:`/tmp/installation-splits-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'Reset examples',exact:true}).click();
   await page.getByRole('button',{name:'Confirm reset',exact:true}).click();
   await page.getByLabel('Return date (optional)').fill('');
   await page.getByRole('button',{name:'Record completed work',exact:true}).click();
   await page.getByRole('tab',{name:'Weekly calendar',exact:true}).click();
   await page.getByRole('heading',{name:'Unscheduled remaining work'}).waitFor();
   assert.deepEqual(errors,[]);
   console.log(`PASS ${width}px: split, partial usage, final reconciliation, weekly filter, persistence, unscheduled remainder, no overflow`);
   await context.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

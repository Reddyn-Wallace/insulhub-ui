/* eslint-disable @typescript-eslint/no-require-imports */
// Production-build UI smoke test. All business API requests are simulated; no SMS is sent.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const base = process.env.SMS_SMOKE_BASE_URL || 'http://localhost:3108';
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Use a local preview only');
  const browser = await chromium.launch({headless:true, channel: process.env.SMS_SMOKE_BROWSER || "chrome"});
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
      const page = await context.newPage(); page.setDefaultTimeout(12000); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      const id='abcdefabcdefabcdefabcdef'; let sends=0; let message=null;
      const job={_id:id,jobNumber:99999,stage:'LEAD',lead:{leadStatus:'NEW'},client:{contactDetails:{name:'SMS Test Contact',phoneMobile:'0211234567',email:'test@example.test',streetAddress:'Test Street'}},notes:''};
      await context.addInitScript(()=>{ localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'staff',firstname:'Test',lastname:'Staff',role:'ADMIN'})); });
      await page.route('**/*',async route=>{
        const req=route.request(); const url=new URL(req.url());
        const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
        if(url.pathname==='/graphql')return json({data:{job,users:{results:[]},jobs:{results:[],total:0}}});
        if(url.origin!==base)return route.abort();
        if(!url.pathname.startsWith('/api/'))return route.continue();
        if(url.pathname.endsWith('/sms')) {
          if(req.method()==='POST') {const data=req.postDataJSON(); if(data.action==='check')message={...message,status:'sent'};else {sends++;message={...data,status:'accepted',senderLabel:'Business SMS',actorName:'Test Staff',failureReason:''};}return json({message});}
          return json({enabled:true,senders:[{id:'22222222-2222-4222-8222-222222222222',label:'Business SMS'}],message});
        }
        if(url.pathname.endsWith('/campaign-communications'))return json({communications:message?[{...message,source:'crm_sms',channel:'sms',renderedBody:message.body,renderedSubject:'',sentAt:new Date().toISOString()}]:[]});
        if(url.pathname==='/api/contact-templates')return json({templates:[{id:'33333333-3333-4333-8333-333333333333',title:'Test template',channel:'sms',body:'Hello {firstname}',subject:''}]});
        if(url.pathname==='/api/site-plan-drawings')return json({drawings:[]});
        return json({rows:[],planning:[],settings:{},senders:[]});
      });
      await page.goto(`${base}/jobs/${id}`);
      await page.getByRole('button',{name:'Send SMS from CRM',exact:true}).waitFor().catch(async error => { console.error(errors, await page.locator('body').innerText()); throw error; });
      await page.getByRole('button',{name:'💬 Text',exact:true}).click();
      assert.equal(await page.locator('a[href^="sms:"]').count()>0,true,'Manual SMS links remain');
      await page.getByRole('button',{name:'×',exact:true}).click();
      await page.getByRole('button',{name:'✉️ Email',exact:true}).click();
      assert.equal(await page.locator('a[href^="mailto:"]').count()>0,true,'Manual email links remain');
      await page.getByRole('button',{name:'×',exact:true}).click();
      await page.getByRole('button',{name:'Send SMS from CRM',exact:true}).click();
      await page.getByLabel('Template').selectOption('33333333-3333-4333-8333-333333333333');
      await page.getByRole('textbox',{name:'Message',exact:true}).fill('Exact test message');
      await page.getByRole('button',{name:'Send SMS',exact:true}).click();
      await page.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'hidden'});
      assert.equal(sends,1);assert.equal(message.body,'Exact test message');
      assert.equal(await page.getByRole('button',{name:'Check message status',exact:true}).count(),0);
      await page.getByRole('status').getByText('SMS: Sent',{exact:true}).waitFor();
      await page.screenshot({path:`/tmp/insulhub-job-sms-${width}.png`,fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'No horizontal overflow');
      assert.deepEqual(errors,[],'No browser exceptions');
      await page.reload();
      await page.getByRole('button',{name:'Send SMS from CRM',exact:true}).click();
      assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'');
      assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).isDisabled(),false);
      assert.equal(sends,1,'Reload did not resend');
      console.log(`${width}px: manual SMS/email preserved; CRM composer, exact send, status check and reload recovery passed`);
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

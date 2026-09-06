/* eslint-disable @typescript-eslint/no-require-imports */
// Production-build UI smoke test. All business API requests are simulated; no email or SMS is sent.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const base = process.env.EMAIL_SMOKE_BASE_URL || 'http://localhost:3109';
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Use a local preview only');
  const browser = await chromium.launch({headless:true, channel: process.env.EMAIL_SMOKE_BROWSER || "chrome"});
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      const page = await context.newPage(); page.setDefaultTimeout(12000); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
      const id='abcdefabcdefabcdefabcdef'; let sends=0; let message=null; let uncertain=false; let releaseHistory; let firstHistory=true;
      const job={_id:id,jobNumber:99999,stage:'LEAD',lead:{leadStatus:'NEW'},client:{contactDetails:{name:'SMS Test Contact',phoneMobile:'0211234567',email:'test@example.test',streetAddress:'Test Street'}},notes:''};
      await context.addInitScript(()=>{ if(window!==window.top)return; localStorage.setItem('token','simulation-only');localStorage.setItem('me',JSON.stringify({_id:'staff',firstname:'Test',lastname:'Staff',role:'ADMIN'})); });
      await page.route('**/*',async route=>{
        const req=route.request(); const url=new URL(req.url());
        const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
        if(url.pathname==='/graphql')return json({data:{job,users:{results:[]},jobs:{results:[],total:0}}});
        if(url.origin!==base)return route.abort();
        if(url.pathname==='/sw.js')return route.abort();
        if(!url.pathname.startsWith('/api/'))return route.continue();
        if(url.pathname.endsWith('/sms'))return json({enabled:true,senders:[],message:null});
        if(url.pathname.endsWith('/email')) {
          if(req.method()==='POST') {const data=req.postDataJSON(); sends++;await new Promise(resolve=>setTimeout(resolve,600));message={...data,status:uncertain?'unknown':'sent',senderLabel:'Business Gmail',senderValue:'staff@example.test',actorName:'Test Staff',renderedBody:data.body+'\n\nStaff signature',renderedHtml:data.body+'<br><br><b>Staff signature</b>',failureReason:uncertain?'Check Gmail Sent folder.':'',createdAt:new Date().toISOString()};return json({message});}
          return json({senders:[{id:'22222222-2222-4222-8222-222222222222',label:'Business Gmail',senderValue:'staff@example.test',signatureHtml:'<b>Staff signature</b>'}],message});
        }
        if(url.pathname.endsWith('/campaign-communications') && firstHistory) { firstHistory=false; await new Promise(resolve=>{releaseHistory=resolve;}); return json({communications:[]}); }
        if(url.pathname.endsWith('/campaign-communications'))return json({communications:message?[{...message,source:'crm_email',channel:'email',renderedSubject:message.subject,sentAt:message.createdAt}]:[]});
        if(url.pathname==='/api/contact-templates')return json({templates:[{id:'33333333-3333-4333-8333-333333333333',title:'Email template',channel:'email',body:'Hello {firstname}',subject:'Booking'}]});
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
      await page.getByRole('button',{name:'Send email from CRM',exact:true}).click();
      await page.getByLabel('Template').selectOption('33333333-3333-4333-8333-333333333333');
      await page.getByLabel('Subject',{exact:true}).fill('Booking — Māori text');
      await page.getByRole('textbox',{name:'Message',exact:true}).fill('Exact email message');
      assert.equal(await page.locator('iframe[title="Email preview"]').count(),0);
      await page.getByRole('button',{name:'Send email',exact:true}).click();
      await page.getByRole('textbox',{name:'Message',exact:true}).waitFor({state:'hidden',timeout:500});
      await page.getByRole('button').filter({hasText:'CRM email'}).getByText('Sending',{exact:true}).waitFor();
      await page.getByRole('button').filter({hasText:'CRM email'}).getByText('Sent',{exact:true}).waitFor();
      assert.equal(await page.getByText('Email: Sent',{exact:true}).count(),0);
      const staleHistory = page.waitForResponse(response=>response.url().endsWith('/campaign-communications'));
      releaseHistory(); await staleHistory;
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.getByRole('button').filter({hasText:'CRM email'}).getByText('Sent',{exact:true}).waitFor();
      assert.equal(sends,1);assert.equal(message.body,'Exact email message');assert.equal(message.subject,'Booking — Māori text');
      await page.getByRole('button').filter({hasText:'CRM email'}).click();
      await page.frameLocator('iframe[title="Email preview"]').getByText('Staff signature',{exact:true}).waitFor();
      await page.getByRole('button',{name:'×',exact:true}).click();
      await page.screenshot({path:`/tmp/insulhub-job-email-${width}.png`,fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'No horizontal overflow');
      assert.deepEqual(errors,[],'No browser exceptions');
      await page.reload();
      await page.getByRole('button',{name:'Send email from CRM',exact:true}).click();
      assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'');
      assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).isDisabled(),false);
      assert.equal(sends,1,'Reload did not resend');
      uncertain=true;
      await page.getByLabel('Subject',{exact:true}).fill('Uncertain example');
      await page.getByRole('textbox',{name:'Message',exact:true}).fill('Uncertain body');
      await page.getByRole('button',{name:'Send email',exact:true}).click();
      await page.getByRole('status').getByText('Send not confirmed',{exact:true}).waitFor();
      assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).isDisabled(),true);
      await page.reload();
      await page.getByRole('button',{name:'Send email from CRM',exact:true}).click();
      assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'Uncertain body');
      assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).isDisabled(),true);
      assert.equal(sends,2,'Unknown attempt was not resent');
      console.log(`${width}px: manual contact links, single editor, saved signature, immediate close, exact send, saved history, fresh compose and uncertain reload protection passed`);
      await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

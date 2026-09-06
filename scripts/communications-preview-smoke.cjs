/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const base = process.env.PREVIEW_BASE_URL || 'http://localhost:3111';
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Local preview only');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width < 761 ? 844 : 980 } });
      const page = await context.newPage(); const errors = []; const apiCalls = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/') || url.pathname === '/graphql' || route.request().method() !== 'GET') { apiCalls.push(url.pathname); return route.abort(); }
        return route.continue();
      });
      const back = async () => { if (width < 761) await page.getByRole('button', { name: 'Back to conversations' }).click(); };
      await page.goto(`${base}/communications-preview`);
      await page.getByRole('heading', { name: 'Communications', exact: false }).waitFor();
      await page.screenshot({ path: `/tmp/insulhub-conversations-list-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: /Ready for your installation/ }).click();
      const oldest = page.locator('.cp-email').first();
      await oldest.locator(':scope > summary').click();
      await oldest.getByText('Show signature & quoted text', { exact: true }).click();
      await oldest.getByText('Alex Morgan\nInsulmax · Wellington team', { exact: true }).waitFor();
      await oldest.locator(':scope > summary').click();
      await page.locator('.cp-email').last().scrollIntoViewIfNeeded();
      await page.getByLabel('Reply message').fill('You can leave a key with the neighbour.');
      await page.screenshot({ path: `/tmp/insulhub-conversations-email-${width}.png`, fullPage: true });
      await back();
      await page.getByRole('button', { name: 'SMS', exact: true }).click();
      assert.equal(await page.locator('.cp-thread').count(), 1);
      await page.getByRole('button', { name: /Texts with Sophie/ }).click();
      await page.getByLabel('Sending account').selectOption('alex');
      await page.getByLabel('Reply message').fill('Thanks, see you Thursday!');
      await page.getByRole('button', { name: 'Send demo reply' }).click();
      await page.getByText('Thanks, see you Thursday!', { exact: true }).last().waitFor();
      await page.getByText('· CRM · Alex’s mobile', { exact: true }).waitFor();
      await page.getByRole('status').getByText('Demo reply added. Nothing was sent.', { exact: true }).waitFor();
      await page.screenshot({ path: `/tmp/insulhub-conversations-sms-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await back(); await page.getByRole('button', { name: 'All messages' }).click();
      await page.getByRole('button', { name: /Ready for your installation/ }).click();
      assert.equal(await page.getByLabel('Reply message').inputValue(), 'You can leave a key with the neighbour.');
      await page.getByLabel('Sending account').selectOption('alex');
      await page.getByRole('button', { name: 'Send demo reply' }).click();
      await page.getByText('alex@example.test → sophie@example.test', { exact: true }).waitFor();
      await back();
      await page.getByRole('button', { name: /A quick question about the garage/ }).click();
      assert.equal(await page.getByLabel('Reply message').isDisabled(), true);
      await page.getByRole('button', { name: 'Choose job', exact: true }).click();
      await page.getByRole('button', { name: '#0921 · 8 Rimu Street', exact: true }).click();
      assert.equal(await page.getByLabel('Reply message').isDisabled(), false);
      await back();
      await page.getByLabel('Search conversations').fill('not a real conversation');
      await page.getByRole('heading', { name: 'No conversations found' }).waitFor();
      await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
      assert.equal(await page.locator('.cp-thread').count(), 4);
      assert.deepEqual(apiCalls, [], 'Demo must not contact business APIs'); assert.deepEqual(errors, []);
      console.log(`${width}px: filters, search, drafts, demo replies, sender selection, job assignment and reset passed; zero API calls`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

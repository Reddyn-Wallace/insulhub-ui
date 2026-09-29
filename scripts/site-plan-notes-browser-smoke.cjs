/* eslint-disable @typescript-eslint/no-require-imports */
// Local browser check: all business APIs are simulated, including PDF uploads.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const base = process.env.SITE_PLAN_SMOKE_BASE_URL || 'http://localhost:3116';
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw Error('Local preview only');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', hasTouch: width < 600 });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      async function drag(start, end) {
        if (width < 600) {
          const point = p => [{ x: p.x, y: p.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(start) });
          for (let i = 1; i <= 10; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point({ x: start.x + (end.x - start.x) * i / 10, y: start.y + (end.y - start.y) * i / 10 }) });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(start.x, start.y); await page.mouse.down();
          await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up();
        }
      }
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const id = 'abcdefabcdefabcdefabcdef';
      let document = { schemaVersion: 1, templateVersion: 'site-plan-template-v2', showDimensions: false,
        walls: [{ id: 'wall', start: { x: 3, y: 3 }, end: { x: 14, y: 3 }, style: 'solid' }],
        textNotes: [{ id: 'note', text: 'Access\nhatch', x: 8, y: 8, fontSize: 0.82, boxWidth: 4, boxHeight: 2.5 }] };
      let lastPdfFileName = null;
      let revision = 1;
      let pdfBytes;
      const job = { _id: id, jobNumber: 99999, quote: { files_QuoteSitePlan: [] }, client: { contactDetails: { streetAddress: '14 Kauri Street' } } };
      await page.addInitScript(() => {
        localStorage.setItem('token', 'local-test-token');
        localStorage.setItem('me', JSON.stringify({ _id: 'tester', firstname: 'Test', role: 'ADMIN' }));
      });
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/graphql') {
          const body = request.postDataJSON();
          if (body.query?.includes('mutation AddFiles')) job.quote.files_QuoteSitePlan = body.variables.fileNames;
          return json({ data: { job, me: { _id: 'tester' } } });
        }
        if (url.pathname === '/files/upload') {
          const body = request.postDataBuffer();
          const start = body.indexOf(Buffer.from('%PDF-'));
          const end = body.lastIndexOf(Buffer.from('%%EOF'));
          assert.ok(start >= 0 && end > start, 'Upload contains a PDF');
          pdfBytes = body.subarray(start, end + 5);
          fs.writeFileSync(`/tmp/insulhub-note-${width}.pdf`, pdfBytes);
          return json({ fileNames: ['note-test.pdf'] });
        }
        if (url.origin !== base || url.pathname === '/sw.js') return route.abort();
        if (url.pathname.startsWith('/api/site-plan-drawings/')) {
          if (request.method() === 'PATCH') {
            const input = request.postDataJSON();
            if (input.document) document = input.document;
            if (input.lastPdfFileName) lastPdfFileName = input.lastPdfFileName;
            revision++;
          }
          return json({ drawing: { id: '11111111-1111-4111-8111-111111111111', name: 'Ground floor', revision, document, lastPdfFileName } });
        }
        if (url.pathname.startsWith('/api/')) return json({});
        return route.continue();
      });
      const url = `${base}/jobs/${id}/site-plan-draw/11111111-1111-4111-8111-111111111111`;
      await page.goto(url);
      await expect(page.getByPlaceholder('Drawing name, e.g. Ground floor')).toHaveValue('Ground floor');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const svg = page.locator('svg').filter({ has: page.locator('text').filter({ hasText: 'Access' }) }).first();
      const bounds = await svg.boundingBox();
      const origin = { x: bounds.x + bounds.width * 8 / 18, y: bounds.y + bounds.height * 8 / 17 };
      await page.mouse.click(origin.x, origin.y);
      const resize = page.getByRole('button', { name: 'Resize note' });
      const handle = await resize.boundingBox();
      const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await drag(start, { x: origin.x + (start.x - origin.x) * 1.5, y: origin.y + (start.y - origin.y) * 1.5 });
      const noteBox = svg.locator('g').filter({ has: page.locator('text').filter({ hasText: 'Access' }) }).first().locator('rect').first();
      const before = await noteBox.boundingBox();
      const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      const rotate = await page.getByRole('button', { name: 'Rotate note' }).boundingBox();
      const rx = rotate.x + rotate.width / 2, ry = rotate.y + rotate.height / 2;
      await drag({ x: rx, y: ry }, { x: centre.x + centre.y - ry, y: centre.y });
      const after = await noteBox.boundingBox();
      assert.ok(Math.abs(after.x + after.width / 2 - centre.x) < 1, 'Rotation keeps the horizontal centre fixed');
      assert.ok(Math.abs(after.y + after.height / 2 - centre.y) < 1, 'Rotation keeps the vertical centre fixed');
      await page.screenshot({ path: `/tmp/insulhub-note-${width}.png` });
      const save = page.getByRole('button', { name: 'Save', exact: true });
      await save.scrollIntoViewIfNeeded(); await save.click();
      await expect(save).toBeDisabled();
      assert.ok(Math.abs(document.textNotes[0].fontSize - 1.23) < 0.02, 'Text grows with resize handle');
      assert.ok(Math.abs(document.textNotes[0].boxWidth - 6) < 0.05, 'Box grows proportionally');
      assert.equal(document.textNotes[0].rotation, 90);
      await page.reload();
      await expect(page.locator('g[transform^="rotate(90 8 "]')).toBeVisible();
      await page.getByRole('button', { name: 'Create PDF' }).click();
      await expect(page.getByRole('button', { name: 'Update PDF' })).toBeVisible({ timeout: 15000 });
      assert.ok(pdfBytes?.length > 1000);
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(`PASS ${width}px: resize, rotate, save/reopen, PDF export, no page errors`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

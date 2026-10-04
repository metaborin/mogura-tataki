import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { startServer } from './server.mjs';

// Reuse a caller-provided Playwright installation; the game itself needs no npm.
const moduleURL = process.env.PLAYWRIGHT_MODULE || new URL('../../../manabi-sugoroku/node_modules/@playwright/test/index.mjs', import.meta.url).href;
const { chromium, expect } = await import(moduleURL);
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
await mkdir('artifacts', { recursive: true });

async function ready(page) {
  await expect(page.locator('#pwa-status')).toContainText('オフラインの じゅんびが できたよ', { timeout: 20000 });
}
async function controllerVersion(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => { channel.port1.close(); resolve(data.version); };
      (navigator.serviceWorker.controller || registration.active).postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
    });
  });
}

try {
  const app = await startServer({ port: 0 });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(app.url); await ready(page);
    await expect(page.locator('#pwa-update')).toBeHidden();
    await page.evaluate(() => localStorage.setItem('mogura_high', '17'));
    await page.reload(); await ready(page);
    await page.locator('#pwa-help').click();
    await expect(page.locator('#pwa-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pwa-dialog')).not.toBeVisible();
    await page.screenshot({ path: 'artifacts/pwa-desktop.png' });
    await context.setOffline(true); await page.reload(); await ready(page);
    await expect(page.locator('#pwa-status')).toContainText('オフライン');
    assert.equal(await page.evaluate(() => localStorage.getItem('mogura_high')), '17');
    await page.locator('#start-btn').click();
    await expect(page.locator('#pwa-help')).toBeDisabled();
    const started = Date.now();
    while (await page.locator('#result-screen').evaluate((node) => node.classList.contains('hidden'))) {
      assert(Date.now() - started < 40000, '30-second game completes without a timer backdoor');
      for (let key = 1; key <= 9; key++) await page.keyboard.press(String(key));
      await page.waitForTimeout(180);
    }
    assert(Date.now() - started >= 28500, 'real game duration is retained');
    assert(Number(await page.locator('#final-score').textContent()) > 0, 'keyboard still hits real moles');
    const saved = await page.evaluate(() => localStorage.getItem('mogura_high'));
    assert(Number(saved) >= 17);
    await expect(page.locator('#high-score')).toHaveText(saved);
    await expect(page.locator('#pwa-help')).toBeEnabled();
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('mogura_high')), saved);
    assert.deepEqual(errors, []);
    console.log('PASS initial preparation, help keyboard, real 30-second keyboard game, offline reload, saved high score');
  } finally { await context.close(); await app.close(); }

  const mobileApp = await startServer({ port: 0 });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await mobile.newPage(); await page.goto(mobileApp.url); await ready(page);
    const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(sizes.scroll <= sizes.width);
    await page.screenshot({ path: 'artifacts/pwa-touch.png' });
    await page.locator('#start-btn').tap();
    await expect(page.locator('#start-screen')).toHaveClass(/hidden/);
    const box = await page.locator('#game').boundingBox();
    for (let repeat = 0; repeat < 15; repeat++) {
      for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
        await page.touchscreen.tap(box.x + (90 + column * 210) / 600 * box.width, box.y + (110 + row * 190) / 640 * box.height);
      }
      if (Number(await page.locator('#score').textContent()) > 0) break;
      await page.waitForTimeout(200);
    }
    assert(Number(await page.locator('#score').textContent()) > 0, 'touch still hits real moles');
    console.log('PASS 390px layout and real touch hits');
  } finally { await mobile.close(); await mobileApp.close(); }

  const updatingApp = await startServer({ port: 0, oldVersion: true });
  const updating = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  try {
    const page = await updating.newPage(); await page.goto(updatingApp.url); await ready(page); await page.reload(); await ready(page);
    assert.equal(await controllerVersion(page), 'mogura-tataki-precache-v0');
    await page.evaluate(async () => { localStorage.setItem('mogura_high', '42'); await caches.open('another-app-sentinel'); });
    const second = await updating.newPage(); await second.goto(updatingApp.url); await ready(second);
    await page.bringToFront();
    await page.locator('#start-btn').click();
    let navigations = 0; page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
    updatingApp.setCurrent();
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect(page.locator('#pwa-update')).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => Number(await page.locator('#time').textContent()), { timeout: 10000 }).toBeLessThan(28);
    assert.equal(navigations, 0);
    assert.equal(await controllerVersion(page), 'mogura-tataki-precache-v0');
    await expect(page.locator('#pwa-help')).toBeDisabled();
    await page.close();
    assert(await second.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)));
    await second.close();
    // All old clients are closed. Wait for natural activation through the worker only.
    await expect.poll(async () => {
      for (const worker of updating.serviceWorkers()) {
        try { if (await worker.evaluate(() => self.registration.active?.state === 'activated' && !self.registration.waiting)) return true; }
        catch { /* Superseded worker may close while being observed. */ }
      }
      return false;
    }).toBe(true);
    const reopened = await updating.newPage(); await reopened.goto(updatingApp.url); await ready(reopened);
    assert.equal(await controllerVersion(reopened), 'mogura-tataki-precache-v1');
    assert.equal(await reopened.evaluate(() => localStorage.getItem('mogura_high')), '42');
    const names = await reopened.evaluate(() => caches.keys());
    assert(names.includes('another-app-sentinel')); assert(!names.includes('mogura-tataki-precache-v0'));
    await updating.setOffline(true); await reopened.reload(); await ready(reopened);
    console.log('PASS waiting update never reloads play; second tab blocks activation; closing all activates safely; save and sibling cache survive');
  } finally { await updating.close(); await updatingApp.close(); }

  const failureApp = await startServer({ port: 0, failAsset: true });
  const failure = await browser.newContext();
  try {
    const page = await failure.newPage(); await page.goto(failureApp.url);
    await expect(page.locator('#pwa-status')).toContainText('じゅんびが できなかったよ', { timeout: 20000 });
    await expect(page.locator('#pwa-status')).not.toContainText('じゅんびが できたよ');
    await page.locator('#start-btn').click(); await expect(page.locator('#start-screen')).toHaveClass(/hidden/);
    console.log('PASS failed initial precache reports failure and game remains playable');
  } finally { await failure.close(); await failureApp.close(); }

  const unsupportedApp = await startServer({ port: 0 });
  const unsupported = await browser.newContext();
  try {
    await unsupported.addInitScript(() => { delete Navigator.prototype.serviceWorker; });
    const page = await unsupported.newPage(); await page.goto(unsupportedApp.url);
    await expect(page.locator('#pwa-status')).toContainText('この ブラウザでは');
    await page.locator('#start-btn').click(); await expect(page.locator('#start-screen')).toHaveClass(/hidden/);
    console.log('PASS unavailable Service Worker does not block the game');
  } finally { await unsupported.close(); await unsupportedApp.close(); }
} finally { await browser.close(); }

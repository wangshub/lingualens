import { test, expect, chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let context: BrowserContext;
let worker: Worker;
let server: Server;
let origin: string;
let extensionId: string;
let userDataDir: string;
let failedOnce = false;
const fixture = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>LinguaLens test article</title><style>body{max-width:720px;margin:70px auto;font:18px/1.8 system-ui;color:#182230}h1{font-size:34px}pre{background:#f1f5f9;padding:20px}a{color:#2563eb}button{padding:10px}</style></head><body><h1>Read beyond borders.</h1><p id="first">Hello <strong>world</strong>. Read <a href="#more">more stories</a> today.</p><p id="second">Translation keeps the original meaning and the number 2026.</p><p id="failure">FAIL paragraph for a single retry.</p><p id="more">Keep your links, emphasis, and page interactions.</p><pre><code>const original = "DO NOT TRANSLATE";</code></pre><div hidden>Hidden content stays unchanged.</div><div contenteditable="true">Editable draft stays unchanged.</div><button id="counter">Click counter</button></body></html>`;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixture); return; }
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString()) as { messages: { content: string }[] };
    if (req.url?.startsWith('/unauthorized') || req.headers.authorization !== 'Bearer fixture-key') { res.writeHead(401); res.end('{}'); return; }
    const user = body.messages.at(-1)!.content;
    if (req.url?.startsWith('/fail-once') && user.includes('FAIL') && !failedOnce) { failedOnce = true; res.writeHead(400); res.end('{}'); return; }
    const output = user === 'Reply OK.' ? 'OK' : user.split('\n').map((line) => {
      const value = JSON.parse(line) as { id: string; text: string };
      return JSON.stringify({ id: value.id, text: `译：${value.text}` });
    }).join('\n') + '\n';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const chunks = Array.from(output.matchAll(/[\s\S]{1,9}/gu), (match) => match[0]);
    const tick = () => {
      if (res.destroyed) return;
      const content = chunks.shift();
      if (content === undefined) { res.end('data: [DONE]\n\n'); return; }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`);
      setTimeout(tick, req.url?.startsWith('/slow') ? 100 : 8);
    };
    tick();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  origin = `http://127.0.0.1:${address.port}`;
  userDataDir = await mkdtemp(join(tmpdir(), 'lingualens-e2e-'));
  const extension = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  await mkdir('artifacts/screenshots', { recursive: true });
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

async function configure(path = '/v1') {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.getByLabel('配置名称', { exact: true }).fill('Local test model');
  await page.getByLabel('API Base URL', { exact: true }).fill(origin + path);
  await page.getByLabel('API Key', { exact: true }).fill('fixture-key');
  await page.getByLabel('模型名称', { exact: true }).fill('fixture-translator');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '配置已保存' })).toBeVisible();
  return page;
}

async function command(tabUrl: string, message: object) {
  return worker.evaluate(async ({ tabUrl, message }) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === tabUrl);
    if (!tab?.id) throw new Error('Fixture tab not found');
    return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  }, { tabUrl, message });
}

async function motionFrames(page: Page, selector: string, name: string) {
  const target = page.locator(selector).first();
  await target.evaluate((element) => {
    const el = element as HTMLElement;
    el.style.animation = 'none'; void el.offsetWidth;
    el.style.animation = 'settle 3s ease-out both';
    const animation = el.getAnimations()[0]!; animation.pause(); animation.currentTime = 0;
  });
  for (const [i, time] of [0, 1500, 3000].entries()) {
    await target.evaluate((element, time) => { element.getAnimations()[0]!.currentTime = time; }, time);
    await page.screenshot({ path: `artifacts/screenshots/${name}-${i}.png` });
  }
  await target.evaluate((element) => { (element as HTMLElement).style.animation = ''; });
}

test('settings save, reload, API key masking, connection errors and multiple defaults', async () => {
  const page = await configure();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByText('连接成功，模型已返回响应。')).toBeVisible();
  await page.reload(); await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('fixture-translator');
  await motionFrames(page, '.entrance', 'motion-entry');
  await page.getByRole('button', { name: '添加配置', exact: true }).click();
  await page.getByLabel('配置名称', { exact: true }).fill('DeepSeek research');
  await page.getByLabel('API Base URL', { exact: true }).fill(origin + '/unauthorized/v1');
  await page.getByRole('button', { name: '设为默认', exact: true }).click();
  await expect(page.getByText('默认配置', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('API Key 无效');
  await page.getByLabel('API Base URL', { exact: true }).fill(origin + '/v1');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-key');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByText('配置已保存。', { exact: true })).toBeVisible();
  const save = page.getByRole('button', { name: '保存配置', exact: true });
  await save.scrollIntoViewIfNeeded();
  await save.evaluate((element) => { (element as HTMLElement).style.transitionDuration = '1500ms'; });
  const box = (await save.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 0; i < 3; i++) {
    if (i) await page.waitForTimeout(750);
    await page.screenshot({ path: `artifacts/screenshots/motion-action-${i}.png` });
  }
  await page.mouse.up();
  await expect(page.getByText('配置已保存。', { exact: true })).toBeVisible();
  await save.evaluate((element) => { (element as HTMLElement).style.transitionDuration = ''; });
  await motionFrames(page, '.feedback', 'motion-feedback');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/screenshots/options-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 420, height: 920 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 420);
  await page.screenshot({ path: 'artifacts/screenshots/options-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 640, height: 500 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await page.screenshot({ path: 'artifacts/screenshots/options-200-percent.png', fullPage: true });
  await page.close();
});

test('page streaming, inline identity, exclusion, failure rollback and individual retry', async () => {
  const options = await configure('/fail-once/v1'); await options.close();
  const page = await context.newPage(); await page.goto(origin + '/article');
  await page.evaluate(() => {
    const link = document.querySelector('a')!;
    Object.assign(window, { originalLink: link, clicked: 0 });
    link.addEventListener('click', (event) => { event.preventDefault(); const w = window as typeof window & { clicked: number }; w.clicked++; });
  });
  await command(page.url(), { type: 'page' });
  await expect(page.locator('#first')).toContainText('译：Hello');
  await expect.poll(async () => (await command(page.url(), { type: 'status' }) as { busy: boolean }).busy).toBe(false);
  await expect(page.locator('#failure')).toHaveText('FAIL paragraph for a single retry.');
  await expect(page.locator('#failure')).toHaveClass(/lingualens-node-failed/);
  await expect(page.locator('code')).toHaveText('const original = "DO NOT TRANSLATE";');
  await expect(page.locator('[contenteditable]')).toHaveText('Editable draft stays unchanged.');
  expect(await page.evaluate(() => document.querySelector('a') === (window as typeof window & { originalLink: Element }).originalLink)).toBe(true);
  await page.locator('a').click();
  expect(await page.evaluate(() => (window as typeof window & { clicked: number }).clicked)).toBe(1);
  const failures = await command(page.url(), { type: 'status' }) as { failed: number };
  expect(failures.failed).toBe(1);
  await page.screenshot({ path: 'artifacts/screenshots/page-failure.png', fullPage: true });
  // Context-menu and toolbar retry both dispatch the same content command. The
  // failed paragraph here is g3: h1, p:first, p:second, p:failure.
  await command(page.url(), { type: 'retry', groupId: 'g3' });
  await expect(page.locator('#failure')).toContainText('译：FAIL');
  await expect.poll(async () => (await command(page.url(), { type: 'status' }) as { busy: boolean }).busy).toBe(false);
  await command(page.url(), { type: 'restore' });
  await expect(page.locator('#first')).toHaveText('Hello world. Read more stories today.');
  expect(await page.evaluate(() => document.querySelector('a') === (window as typeof window & { originalLink: Element }).originalLink)).toBe(true);
  await page.close();
});

test('selection context snapshot, restoration cancellation and real popup actions', async () => {
  const options = await configure('/slow/v1'); await options.close();
  const page = await context.newPage(); await page.goto(origin + '/selection');
  await page.evaluate(() => {
    const p = document.querySelector('#first')!;
    const range = document.createRange(); range.setStart(p.firstChild!, 1); range.setEnd(p.querySelector('strong')!.firstChild!, 3);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  });
  await command(page.url(), { type: 'selection', selectionText: 'ello wor' });
  await expect(page.locator('#first')).toContainText('译：');
  await command(page.url(), { type: 'restore' });
  await expect(page.locator('#first')).toHaveText('Hello world. Read more stories today.');
  await page.waitForTimeout(350);
  await expect(page.locator('#first')).toHaveText('Hello world. Read more stories today.');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  // An extension page opened in a tab would otherwise be the active tab. Mark
  // the article active without closing the popup document being exercised.
  await page.bringToFront();
  await expect(popup.getByLabel('当前模型')).toContainText('Local test model');
  await popup.getByLabel('翻译为').selectOption('English');
  await expect.poll(async () => worker.evaluate(async () => {
    const data = await chrome.storage.local.get('lingualens.settings.v1');
    const settings = data['lingualens.settings.v1'] as { profiles: { id: string; targetLanguage: string }[]; activeProfileId: string };
    return settings.profiles.find((p) => p.id === settings.activeProfileId)?.targetLanguage;
  })).toBe('English');
  await popup.getByRole('button', { name: '翻译当前页面', exact: true }).click();
  await expect(page.locator('#first')).toContainText('译：');
  await popup.locator('main').screenshot({ path: 'artifacts/screenshots/popup.png', animations: 'disabled' });
  await popup.getByRole('button', { name: /还原原文/ }).click();
  await expect(page.locator('#first')).toHaveText('Hello world. Read more stories today.');
  await popup.close(); await page.close();
});

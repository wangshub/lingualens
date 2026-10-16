import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Rasterize the project's own vector mark, using the same geometry as Brand.tsx.
// Icons ship prebuilt; browser installation is required only to regenerate them.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="12" fill="#2563eb"/><path d="M11 10v17h13M25 12a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm6 14 5 6" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
await mkdir('public', { recursive: true });
await writeFile('public/logo.svg', svg + '\n');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.locator('svg').screenshot({ path: `public/icon-${size}.png`, omitBackground: true });
  }
} finally { await browser.close(); }
console.log('Generated 16/32/48/128px icons from the LinguaLens vector mark.');

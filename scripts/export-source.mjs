import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// A reproducible delivery document containing complete source, not excerpts.
const roots = ['package.json', 'wxt.config.ts', 'tsconfig.json', 'eslint.config.js', 'vitest.config.ts', 'playwright.config.ts', '.gitignore', 'entrypoints', 'components', 'utils', 'types', 'assets', '.github/workflows', 'scripts', 'tests', 'LICENSE'];
async function files(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const nested = await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => files(join(path, entry.name))));
    return nested.flat();
  } catch (error) { if (error.code === 'ENOTDIR') return [path]; throw error; }
}
const list = (await Promise.all(roots.map(files))).flat();
const fence = '`'.repeat(4);
const sections = [];
for (const file of list) {
  const lang = file.endsWith('.tsx') ? 'tsx' : file.endsWith('.ts') ? 'ts' : file.endsWith('.yml') ? 'yaml' : file.endsWith('.json') ? 'json' : file.endsWith('.mjs') || file.endsWith('.js') ? 'js' : file.endsWith('.css') ? 'css' : file.endsWith('.html') ? 'html' : 'text';
  sections.push(`## ${file}\n\n${fence}${lang}\n${(await readFile(file, 'utf8')).trimEnd()}\n${fence}`);
}
await writeFile('docs/CORE-SOURCE.md', '# LinguaLens 完整核心源码\n\n由 `pnpm docs:source` 从项目文件生成，包含两个 GitHub Actions workflow。锁文件以仓库中的 `pnpm-lock.yaml` 为准。\n\n' + sections.join('\n\n') + '\n');
console.log(`Exported ${list.length} complete files to docs/CORE-SOURCE.md`);

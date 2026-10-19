import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
// Branch and PR names must not be interpreted as release tags.
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
if (tag) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/, 'Release tag must have the form v1.2.3');
  assert.equal(tag, `v${pkg.version}`, 'Tag and package.json version do not match');
}
if (process.argv.includes('--manifest')) {
  const manifest = JSON.parse(await readFile(new URL('../.output/chrome-mv3/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, pkg.version, 'Manifest and package.json version do not match');
  assert.equal(manifest.manifest_version, 3);
}
console.log(`Version verified: ${pkg.version}`);

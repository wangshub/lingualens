import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const apiOrigin = 'https://chromewebstore.googleapis.com';
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const required = ['CHROME_EXTENSION_ID', 'CHROME_PUBLISHER_ID', 'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN'];
const submissionStates = new Set(['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS']);
const itemStates = new Set([...submissionStates, 'REJECTED', 'CANCELLED']);

/** Keep OAuth values in memory. Never include API response bodies in logs/errors. */
export function webstoreConfig(env) {
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`缺少发布配置：${missing.join(', ')}`);
  const config = Object.fromEntries(required.map((key) => [key, env[key].trim()]));
  if (!/^[a-p]{32}$/.test(config.CHROME_EXTENSION_ID)) throw new Error('CHROME_EXTENSION_ID 应为 32 位 a–p 字母。');
  if (!/^[A-Za-z0-9_-]+$/.test(config.CHROME_PUBLISHER_ID)) throw new Error('CHROME_PUBLISHER_ID 格式无效，请从商店发布者设置复制。');
  return config;
}

async function requestJSON(fetchImpl, url, init, label) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error(`${label}网络连接失败或超时，请稍后重试。`);
  }
  let data;
  try { data = await response.json(); } catch { throw new Error(`${label}返回了无法解析的响应（HTTP ${response.status}）。`); }
  if (!response.ok || data?.error) {
    if (data?.error === 'invalid_grant') throw new Error('Google 授权已失效，请重新获取 CHROME_REFRESH_TOKEN。');
    if (data?.error === 'invalid_client') throw new Error('OAuth 客户端验证失败，请检查 CHROME_CLIENT_ID 和 CHROME_CLIENT_SECRET。');
    if (response.status === 401) throw new Error(`${label}认证失败，请检查 Google OAuth 凭据。`);
    if (response.status === 403) throw new Error(`${label}权限不足，请确认已启用 Chrome Web Store API，且授权账号拥有该扩展的发布权限。`);
    if (response.status === 404) throw new Error(`${label}未找到扩展，请检查 CHROME_PUBLISHER_ID 与 CHROME_EXTENSION_ID。`);
    throw new Error(`${label}失败（HTTP ${response.status}），请查看商店控制台。`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${label}返回的响应格式无效。`);
  return data;
}

/** Exchange the existing user OAuth credentials for a short-lived V2 bearer token. */
export async function refreshAccessToken(config, fetchImpl = fetch) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.CHROME_CLIENT_ID,
    client_secret: config.CHROME_CLIENT_SECRET,
    refresh_token: config.CHROME_REFRESH_TOKEN,
  });
  const result = await requestJSON(fetchImpl, tokenEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, 'Google OAuth');
  if (typeof result.access_token !== 'string' || !result.access_token || /[\r\n]/.test(result.access_token)) {
    throw new Error('Google OAuth 未返回有效的 access token。');
  }
  return result.access_token;
}

/** Only explicit publish calls upload a ZIP; --check performs a read-only status query. */
export async function runWebstore({ env = process.env, zipPath, checkOnly = false, fetchImpl = fetch, wait = delay, maxPolls = 60 } = {}) {
  const config = webstoreConfig(env);
  let zip;
  if (!checkOnly) {
    if (!zipPath) throw new Error('请提供插件 ZIP 路径，或使用 --check 只检查连接。');
    try { zip = await readFile(zipPath); } catch { throw new Error('无法读取插件 ZIP，请先运行 pnpm zip 并检查路径。'); }
    if (zip.length < 4 || zip.readUInt32LE(0) !== 0x04034b50) throw new Error('指定文件不是有效的插件 ZIP。');
  }
  const token = await refreshAccessToken(config, fetchImpl);
  const resource = `publishers/${encodeURIComponent(config.CHROME_PUBLISHER_ID)}/items/${config.CHROME_EXTENSION_ID}`;
  const headers = { Authorization: `Bearer ${token}` };
  const statusURL = `${apiOrigin}/v2/${resource}:fetchStatus`;
  const status = await requestJSON(fetchImpl, statusURL, { headers }, '查询商店状态');
  if (checkOnly) return { checked: true, published: status.publishedItemRevisionStatus?.state, submitted: status.submittedItemRevisionStatus?.state };

  // Never cancel or overwrite a submission that the user is already waiting for.
  const pending = status.submittedItemRevisionStatus?.state;
  if (pending === 'PENDING_REVIEW' || pending === 'STAGED') throw new Error('当前扩展仍在审核或等待发布，请先在商店控制台处理现有提交。');
  const published = status.publishedItemRevisionStatus?.state;
  // A successful lookup can contain only itemId/name/publicKey. Missing revision
  // fields do not establish that a manually submitted version is safe to replace.
  if ((!itemStates.has(published) && !itemStates.has(pending)) || (pending && !itemStates.has(pending))) {
    throw new Error('商店未返回可确认的版本状态，请先在开发者控制台核对首个版本的审核或发布情况；本次未上传文件。');
  }
  let upload = await requestJSON(fetchImpl, `${apiOrigin}/upload/v2/${resource}:upload`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: zip,
  }, '上传插件');
  let state = upload.uploadState;
  for (let attempt = 0; (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') && attempt < maxPolls; attempt++) {
    await wait(5_000);
    upload = await requestJSON(fetchImpl, statusURL, { headers }, '检查上传结果');
    state = upload.lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') {
    if (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') throw new Error('插件上传仍在处理中，请稍后查看商店控制台；本次没有提交审核。');
    throw new Error('插件上传未成功，请检查商店控制台中的文件校验结果；本次没有提交审核。');
  }
  const result = await requestJSON(fetchImpl, `${apiOrigin}/v2/${resource}:publish`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  }, '提交商店审核');
  if (!submissionStates.has(result.state)) throw new Error('商店未返回预期的提交状态，请在控制台核对结果。');
  return { checked: false, state: result.state };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('用法：node scripts/chrome-webstore.mjs <插件.zip>\n      node scripts/chrome-webstore.mjs --check\n需要 CHROME_EXTENSION_ID、CHROME_PUBLISHER_ID 及三个 CHROME_* OAuth 环境变量。');
    return;
  }
  if (args.length !== 1 || (args[0].startsWith('--') && args[0] !== '--check')) throw new Error('参数无效，请使用 --help 查看用法。');
  const result = await runWebstore({ zipPath: args[0], checkOnly: args[0] === '--check' });
  if (result.checked) {
    const published = itemStates.has(result.published) ? result.published : '未返回版本状态';
    const submitted = itemStates.has(result.submitted) ? result.submitted : '未返回提交状态';
    console.log(`Chrome Web Store V2 连接正常。已发布：${published}；提交状态：${submitted}。`);
  } else console.log(`Chrome Web Store 返回状态：${result.state}。最终发布以商店审核结果为准。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

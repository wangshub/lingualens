import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Read gcloud ADC privately, then pass each secret to gh through stdin. */
export async function storeWebstoreCredentials({ adcPath, repository, run = spawnSync }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('请通过 --repo 指定 owner/repository。');
  if (!adcPath) throw new Error('请通过 --adc 指定 gcloud 生成的凭据文件。');
  let info;
  let credentials;
  try {
    info = await stat(adcPath);
    credentials = JSON.parse(await readFile(adcPath, 'utf8'));
  } catch { throw new Error('无法读取 ADC 凭据文件，请先完成 gcloud 授权并检查路径。'); }
  if (!info.isFile()) throw new Error('ADC 路径必须指向普通文件。');
  if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('凭据文件权限过宽，请先执行 chmod 600 限制访问。');
  if (credentials?.type !== 'authorized_user') throw new Error('需要 gcloud 用户授权生成的 authorized_user 凭据。');
  const fields = [
    ['CHROME_CLIENT_ID', 'client_id'],
    ['CHROME_CLIENT_SECRET', 'client_secret'],
    ['CHROME_REFRESH_TOKEN', 'refresh_token'],
  ];
  if (fields.some(([, key]) => typeof credentials[key] !== 'string' || !credentials[key].trim())) throw new Error('ADC 中缺少 OAuth 客户端信息或 refresh token，请重新授权。');
  const saved = [];
  for (const [name, key] of fields) {
    // Credentials never enter argv, environment variables, stdout or stderr.
    const result = run('gh', ['secret', 'set', name, '--repo', repository], {
      input: credentials[key], encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000,
    });
    if (result.error || result.status !== 0) throw new Error(`保存 ${name} 失败；已保存 ${saved.length}/3 项。请检查 gh 登录和网络后重试。`);
    saved.push(name);
  }
  return saved;
}

async function main() {
  const { values } = parseArgs({ options: { adc: { type: 'string' }, repo: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('用法：node scripts/store-webstore-credentials.mjs --adc <ADC文件> --repo <owner/repository>\n从权限为 600 的 gcloud 用户 ADC 文件读取三项 OAuth 凭据，通过 stdin 保存到 GitHub Secrets。');
    return;
  }
  const names = await storeWebstoreCredentials({ adcPath: values.adc, repository: values.repo });
  console.log(`已保存：${names.join(', ')}。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

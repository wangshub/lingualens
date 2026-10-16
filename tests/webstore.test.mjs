// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshAccessToken, runWebstore, webstoreConfig } from '../scripts/chrome-webstore.mjs';
import { storeWebstoreCredentials } from '../scripts/store-webstore-credentials.mjs';

// All credentials and HTTP responses here are synthetic; no Google calls occur.
const env = {
  CHROME_EXTENSION_ID: 'a'.repeat(32), CHROME_PUBLISHER_ID: 'test-publisher',
  CHROME_CLIENT_ID: 'test.apps.googleusercontent.com', CHROME_CLIENT_SECRET: 'test-client-secret', CHROME_REFRESH_TOKEN: 'test-refresh-token',
};
const api = `https://chromewebstore.googleapis.com/v2/publishers/test-publisher/items/${env.CHROME_EXTENSION_ID}`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function server(...responses) {
  return vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error('Unexpected HTTP request');
    return response;
  });
}
const token = () => json({ access_token: 'test-access-token' });
let directory;
let zipPath;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'codex-lingualens-webstore-'));
  zipPath = join(directory, 'test.zip');
  await writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe('Chrome Web Store V2 publishing', () => {
  it('rejects missing publisher ID before any request and rejects path injection', async () => {
    const fetchImpl = vi.fn();
    await expect(runWebstore({ env: { ...env, CHROME_PUBLISHER_ID: '' }, checkOnly: true, fetchImpl })).rejects.toThrow('CHROME_PUBLISHER_ID');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => webstoreConfig({ ...env, CHROME_PUBLISHER_ID: '../elsewhere' })).toThrow('格式无效');
  });

  it('checks ownership with V2 without uploading, cancelling or publishing', async () => {
    const fetchImpl = server(token(), json({ submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } }));
    expect(await runWebstore({ env, checkOnly: true, fetchImpl })).toEqual({ checked: true, published: undefined, submitted: 'PENDING_REVIEW' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${api}:fetchStatus`);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer test-access-token');
    const form = fetchImpl.mock.calls[0][1].body;
    expect(form.get('client_secret')).toBe(env.CHROME_CLIENT_SECRET);
    expect(form.get('refresh_token')).toBe(env.CHROME_REFRESH_TOKEN);
    expect(fetchImpl.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
  });

  it('uploads the ZIP to V2 and submits for normal review only after success', async () => {
    const fetchImpl = server(token(), json({}), json({ uploadState: 'SUCCEEDED' }), json({ state: 'PENDING_REVIEW' }));
    expect(await runWebstore({ env, zipPath, fetchImpl })).toEqual({ checked: false, state: 'PENDING_REVIEW' });
    expect(fetchImpl.mock.calls[2][0]).toBe(api.replace('/v2/', '/upload/v2/') + ':upload');
    expect(fetchImpl.mock.calls[2][1].body).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(fetchImpl.mock.calls[3][0]).toBe(`${api}:publish`);
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({ publishType: 'DEFAULT_PUBLISH' });
  });

  it.each(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'])('waits for asynchronous upload state %s', async (uploadState) => {
    const fetchImpl = server(token(), json({}), json({ uploadState }), json({ lastAsyncUploadState: 'IN_PROGRESS' }), json({ lastAsyncUploadState: 'SUCCEEDED' }), json({ state: 'PENDING_REVIEW' }));
    const wait = vi.fn().mockResolvedValue(undefined);
    await runWebstore({ env, zipPath, fetchImpl, wait });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.slice(3, 5).map(([url]) => url)).toEqual([`${api}:fetchStatus`, `${api}:fetchStatus`]);
    expect(fetchImpl.mock.calls[5][0]).toBe(`${api}:publish`);
  });

  it.each(['PENDING_REVIEW', 'STAGED'])('leaves an existing %s submission alone', async (state) => {
    const fetchImpl = server(token(), json({ submittedItemRevisionStatus: { state } }));
    await expect(runWebstore({ env, zipPath, fetchImpl })).rejects.toThrow('处理现有提交');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(['FAILED', 'NOT_FOUND', 'UNEXPECTED'])('does not submit after unsuccessful upload %s', async (uploadState) => {
    const fetchImpl = server(token(), json({}), json({ uploadState }));
    await expect(runWebstore({ env, zipPath, fetchImpl })).rejects.toThrow('本次没有提交审核');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('bounds asynchronous polling and never repeats the upload', async () => {
    const fetchImpl = server(token(), json({}), json({ uploadState: 'IN_PROGRESS' }), json({ lastAsyncUploadState: 'IN_PROGRESS' }), json({ lastAsyncUploadState: 'IN_PROGRESS' }));
    await expect(runWebstore({ env, zipPath, fetchImpl, wait: vi.fn(), maxPolls: 2 })).rejects.toThrow('仍在处理中');
    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith(':upload'))).toHaveLength(1);
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(':publish'))).toBe(false);
  });

  it('reports revoked refresh tokens without exposing the provider body', async () => {
    const fetchImpl = server(json({ error: 'invalid_grant', error_description: env.CHROME_REFRESH_TOKEN }, 400));
    await expect(refreshAccessToken(env, fetchImpl)).rejects.toThrow('重新获取 CHROME_REFRESH_TOKEN');
    const badClient = server(json({ error: 'invalid_client', error_description: env.CHROME_CLIENT_SECRET }, 400));
    await expect(refreshAccessToken(env, badClient)).rejects.toThrow('客户端验证失败');
  });

  it.each([[401, '认证失败'], [403, '权限不足'], [404, '未找到扩展']])('explains HTTP %i without printing sensitive details', async (status, message) => {
    const fetchImpl = server(token(), json({ error: { message: env.CHROME_CLIENT_SECRET } }, status));
    await expect(runWebstore({ env, checkOnly: true, fetchImpl })).rejects.toThrow(message);
  });

  it('does not leak unexpected network or response errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(env.CHROME_CLIENT_SECRET));
    await expect(refreshAccessToken(env, fetchImpl)).rejects.toThrow('网络连接失败或超时');
    const malformed = server(new Response(`not-json-${env.CHROME_REFRESH_TOKEN}`));
    await expect(refreshAccessToken(env, malformed)).rejects.toThrow('无法解析的响应');
  });
});

describe('private ADC import into GitHub Secrets', () => {
  const adc = { type: 'authorized_user', client_id: env.CHROME_CLIENT_ID, client_secret: env.CHROME_CLIENT_SECRET, refresh_token: env.CHROME_REFRESH_TOKEN };
  it('sends secrets through stdin without putting them in arguments', async () => {
    const adcPath = join(directory, 'credentials.json');
    await writeFile(adcPath, JSON.stringify(adc), { mode: 0o600 });
    const run = vi.fn().mockReturnValue({ status: 0 });
    expect(await storeWebstoreCredentials({ adcPath, repository: 'example/lingualens', run })).toEqual(['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN']);
    for (const [index, value] of [adc.client_id, adc.client_secret, adc.refresh_token].entries()) {
      const [command, args, options] = run.mock.calls[index];
      expect(command).toBe('gh');
      expect(args).not.toContain(value);
      expect(options.input).toBe(value);
      expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    }
  });

  it('validates every credential before changing any GitHub secret', async () => {
    const adcPath = join(directory, 'missing.json');
    await writeFile(adcPath, JSON.stringify({ ...adc, refresh_token: '' }), { mode: 0o600 });
    const run = vi.fn();
    await expect(storeWebstoreCredentials({ adcPath, repository: 'example/lingualens', run })).rejects.toThrow('缺少 OAuth');
    expect(run).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('rejects permissive credential files', async () => {
    const adcPath = join(directory, 'public.json');
    await writeFile(adcPath, JSON.stringify(adc), { mode: 0o644 });
    const run = vi.fn();
    await expect(storeWebstoreCredentials({ adcPath, repository: 'example/lingualens', run })).rejects.toThrow('chmod 600');
    expect(run).not.toHaveBeenCalled();
  });

  it('stops on a failed save without printing child process stderr or credentials', async () => {
    const adcPath = join(directory, 'failure.json');
    await writeFile(adcPath, JSON.stringify(adc), { mode: 0o600 });
    const run = vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValue({ status: 1, stderr: adc.refresh_token });
    await expect(storeWebstoreCredentials({ adcPath, repository: 'example/lingualens', run })).rejects.toThrow('保存 CHROME_CLIENT_SECRET 失败；已保存 1/3 项');
    expect(run).toHaveBeenCalledTimes(2);
  });
});

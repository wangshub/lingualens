import type { ModelProfile, Settings } from '../types';
import { defaultSettings } from './defaults';

export const SETTINGS_KEY = 'lingualens.settings.v1';

export function activeProfile(settings: Settings): ModelProfile {
  const profile = settings.profiles.find((p) => p.id === settings.activeProfileId);
  if (!profile) throw new Error('请先在设置中创建并保存模型配置。');
  return profile;
}

/** Accept both a versioned API base and an explicit chat/completions endpoint. */
export function completionUrl(base: string): string {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new Error('API Base URL 不是有效网址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('API 地址须为 HTTP(S)，且不能包含账号、密码、查询参数或锚点。');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.toString();
}

export function validateProfile(profile: ModelProfile): void {
  if (!profile.name.trim() || !profile.model.trim() || !profile.targetLanguage.trim() || !profile.systemPrompt.trim()) {
    throw new Error('请填写配置名称、模型、目标语言和系统 Prompt。');
  }
  completionUrl(profile.baseUrl);
  if (profile.systemPrompt.length > 12000) throw new Error('系统 Prompt 请控制在 12000 字以内。');
  // Empty API keys are valid for local services such as Ollama.
  if (profile.apiKey.includes('\n') || profile.apiKey.includes('\r')) throw new Error('API Key 不能包含换行。');
}

export async function loadSettings(): Promise<Settings> {
  const saved = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Settings | undefined;
  if (saved?.schemaVersion === 1 && Array.isArray(saved.profiles) && saved.profiles.length > 0) return saved;
  return defaultSettings();
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!settings.profiles.length) throw new Error('至少保留一套配置。');
  settings.profiles.forEach(validateProfile);
  activeProfile(settings);
  if (!Number.isInteger(settings.concurrency) || settings.concurrency < 1 || settings.concurrency > 4) throw new Error('并发数须为 1 至 4。');
  if (!Number.isInteger(settings.batchBytes) || settings.batchBytes < 1200 || settings.batchBytes > 12000) throw new Error('每批文本预算须为 1200 至 12000 字节。');
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export function renderPrompt(profile: ModelProfile): string {
  return profile.systemPrompt.replaceAll('{目标语言}', profile.targetLanguage).replaceAll('{targetLanguage}', profile.targetLanguage);
}

/** A page can identify its translation context without receiving the API key
 * or the custom system prompt. Changing any translation input expires results.
 */
export async function translationContext(profile: ModelProfile): Promise<string> {
  const source = JSON.stringify([profile.id, profile.baseUrl.trim(), profile.model.trim(), profile.targetLanguage, profile.systemPrompt]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

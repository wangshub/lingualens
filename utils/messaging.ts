import type { PageCommand, PageStatus, Reply } from '../types';

/** Runtime responses always have a discriminated envelope for friendly UI errors. */
export async function request<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as Reply<T> | undefined;
  if (!response) throw new Error('插件后台没有响应，请重新加载插件。');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export async function currentTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url) || tab.url.startsWith('https://chromewebstore.google.com/')) {
    throw new Error('请打开普通网页。Chrome 内部页面、应用商店和 PDF 阅读器无法翻译。');
  }
  return tab.id;
}

export async function pageAction(command: PageCommand): Promise<PageStatus> {
  return request<PageStatus>({ type: 'dispatch', tabId: await currentTabId(), command });
}

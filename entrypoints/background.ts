import { defineBackground } from 'wxt/utils/define-background';
import type { ModelProfile, PageCommand, Reply, StreamEvent, StreamRequest } from '../types';
import { activeProfile, loadSettings, saveSettings, validateProfile } from '../utils/settings';
import { ApiError, errorMessage, streamChat } from '../utils/api';
import { translateSegments } from '../utils/background-translation';

export default defineBackground(() => {
  // Content scripts cannot read API keys even though storage.local defaults to
  // allowing them. Extension pages and the service worker remain trusted.
  const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

  const setup = async () => {
    await storageReady;
    await saveSettings(await loadSettings());
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: 'selection', title: '翻译选中内容', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'page', title: '翻译整个页面', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'restore', title: '还原原文', contexts: ['all'] });
    chrome.contextMenus.create({ id: 'retry', title: '重试失败段落', contexts: ['all'] });
  };
  chrome.runtime.onInstalled.addListener(() => { void setup().catch(() => undefined); });
  // Context menus persist across worker restarts; do not remove/recreate them
  // on every wake-up, as that races with user clicks.

  async function dispatch(tabId: number, command: PageCommand, frameId = 0): Promise<unknown> {
    try { await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId }); }
    catch {
      try { await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content-scripts/content.js'] }); }
      catch { throw new Error('当前页面不允许注入插件。请打开普通网页；安装或更新插件后也可刷新页面再试。'); }
    }
    const response = command.type === 'restore'
      ? await chrome.tabs.sendMessage(tabId, command)
      : await chrome.tabs.sendMessage(tabId, command, { frameId });
    if (response && typeof response === 'object' && 'error' in response) throw new Error(String(response.error));
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: 'LinguaLens · 网页翻译' });
    return response;
  }

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    const command: PageCommand = info.menuItemId === 'selection'
      ? { type: 'selection', selectionText: info.selectionText ?? '' }
      : info.menuItemId === 'restore' ? { type: 'restore' }
      : info.menuItemId === 'retry' ? { type: 'retry' } : { type: 'page' };
    void dispatch(tab.id, command, info.frameId ?? 0).catch(async (error: unknown) => {
      // The page toast is preferred; the action badge still works on blocked pages.
      await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b91c1c' });
      await chrome.action.setTitle({ tabId: tab.id, title: errorMessage(error) });
    });
  });

  // onMessage must synchronously return true while its Promise resolves.
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
    const msg = message as Record<string, unknown>;
    const trusted = sender.url?.startsWith(chrome.runtime.getURL('options.html')) || sender.url?.startsWith(chrome.runtime.getURL('popup.html'));
    const handle = async (): Promise<unknown> => {
      await storageReady;
      if (msg.type === 'public-settings') {
        const p = activeProfile(await loadSettings());
        return { profileName: p.name, model: p.model, targetLanguage: p.targetLanguage };
      }
      if (msg.type === 'dispatch' && trusted && typeof msg.tabId === 'number' && msg.command && typeof msg.command === 'object') {
        return dispatch(msg.tabId, msg.command as PageCommand);
      }
      if (msg.type === 'test-connection' && trusted) {
        const profile = msg.profile as ModelProfile;
        validateProfile(profile);
        await streamChat(profile, [
          { role: 'system', content: 'This is a connection test. Reply with only the word OK.' },
          { role: 'user', content: 'Reply OK.' },
        ], new AbortController().signal, () => undefined, 20000);
        return { message: '连接成功，模型已返回响应。' };
      }
      throw new ApiError('无法识别的插件请求。');
    };
    void handle().then((data) => respond({ ok: true, data } satisfies Reply<unknown>), (error: unknown) => respond({ ok: false, error: errorMessage(error) } satisfies Reply<never>));
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'lingualens.translation.v1' || port.sender?.id !== chrome.runtime.id || !port.sender.tab || !/^https?:\/\//.test(port.sender.url ?? '')) return;
    const controller = new AbortController();
    let started = false;
    const send = (event: StreamEvent) => { if (!controller.signal.aborted) { try { port.postMessage(event); } catch { controller.abort(); } } };
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener((message: StreamRequest) => {
      if (message.type === 'ping') { send({ type: 'pong' }); return; }
      if (message.type === 'cancel') { controller.abort(); return; }
      if (message.type !== 'translate' || started) return;
      started = true;
      void storageReady.then(() => translateSegments(message.segments, controller.signal, send)).catch((error: unknown) => send({ type: 'fatal', error: errorMessage(error) }));
    });
  });
});

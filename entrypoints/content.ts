import { defineContentScript } from 'wxt/utils/define-content-script';
import type { PageCommand, PublicSettings, ViewMode } from '../types';
import { connectTranslation } from '../utils/content-transport';
import { TranslationController } from '../utils/translation-controller';
import { createPageToolbar } from '../utils/page-toolbar';
import { request } from '../utils/messaging';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  runAt: 'document_idle',
  main(ctx) {
    // Fallback injection after extension installation must not install twice.
    const global = globalThis as typeof globalThis & { __lingualensInstalled?: boolean };
    if (global.__lingualensInstalled) return;
    global.__lingualensInstalled = true;
    const controller = new TranslationController(connectTranslation, () => toolbar.update());
    const context = () => request<PublicSettings>({ type: 'public-settings' });
    const changeView = async (mode: ViewMode) => {
      if (mode === 'original') controller.restore();
      else controller.show(mode, (await context()).cacheKey);
    };
    const toolbar = createPageToolbar(controller, changeView);
    const style = document.createElement('style');
    style.textContent = '.lingualens-node-pending{opacity:.65!important;transition:opacity .15s!important}.lingualens-node-failed{outline:1px dashed #d97706!important;outline-offset:3px!important}@media(prefers-reduced-motion:reduce){.lingualens-node-pending{transition:none!important}}';
    document.documentElement.append(style);
    let savedRanges: Range[] = [];
    ctx.addEventListener(document, 'contextmenu', () => {
      const selection = window.getSelection();
      savedRanges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    }, { capture: true });
    const listener = (command: PageCommand, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
      if (sender.id !== chrome.runtime.id) return;
      const handle = async () => {
        if (command.type === 'ping') return { alive: true };
        if (command.type === 'restore') { controller.restore(); return controller.status; }
        if (command.type === 'view') { await changeView(command.mode); return controller.status; }
        const settings = await context();
        if (command.type === 'page') controller.page(settings.cacheKey, command.mode, command.force);
        if (command.type === 'selection') {
          const selection = window.getSelection();
          const live = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
          const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
          const matches = (ranges: Range[]) => ranges.length > 0 && normalize(ranges.map((r) => r.toString()).join(' ')) === normalize(command.selectionText);
          const ranges = matches(savedRanges) ? savedRanges : matches(live) ? live : [];
          if (!ranges.length || ranges.every((r) => r.collapsed)) throw new Error('选区已失效，请重新选中文本后翻译。');
          controller.selection(ranges, settings.cacheKey); selection?.removeAllRanges(); savedRanges = [];
        }
        if (command.type === 'status' || command.type === 'retry') controller.refreshContext(settings.cacheKey);
        if (command.type === 'retry') controller.retry(command.groupId);
        if (command.type === 'notice') toolbar.notice(command.error);
        return controller.status;
      };
      void handle().then(respond).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '操作失败，请重试。';
        toolbar.notice(message); respond({ ...controller.status, message, error: message });
      });
      return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => {
      controller.dispose(); toolbar.remove(); style.remove();
      chrome.runtime.onMessage.removeListener(listener); global.__lingualensInstalled = false;
    });
  },
});

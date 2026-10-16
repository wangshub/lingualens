import type { Segment, StreamEvent } from '../types';

export type TranslationTransport = (segments: Segment[], receive: (event: StreamEvent) => void) => () => void;

/** Real traffic on the Port every 15 s keeps an MV3 worker alive during slow
 * model responses. Disconnect/navigation cancels fetches in the worker.
 */
export const connectTranslation: TranslationTransport = (segments, receive) => {
  const port = chrome.runtime.connect({ name: 'lingualens.translation.v1' });
  let closed = false;
  const heartbeat = setInterval(() => {
    try { port.postMessage({ type: 'ping' }); } catch { close(); }
  }, 15000);
  const close = () => { if (closed) return; closed = true; clearInterval(heartbeat); port.disconnect(); };
  port.onMessage.addListener((event: StreamEvent) => {
    if (closed) return;
    receive(event);
    if (event.type === 'finished' || event.type === 'fatal') close();
  });
  port.onDisconnect.addListener(() => {
    const runtimeError = chrome.runtime.lastError;
    if (!closed) { closed = true; clearInterval(heartbeat); receive({ type: 'fatal', error: runtimeError ? '插件连接已中断，请刷新页面后重试。' : '翻译后台已断开，请重试。' }); }
  });
  port.postMessage({ type: 'translate', segments });
  return close;
};

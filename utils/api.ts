import type { ModelProfile } from '../types';
import { completionUrl } from './settings';

export class ApiError extends Error {
  constructor(message: string, public readonly retryable = false, public readonly retryAfter = 0, public readonly configurationError = false) { super(message); }
}

/** Handles SSE framing independently of network chunk and UTF-8 boundaries. */
export class SseParser {
  private buffer = '';
  private lines: string[] = [];
  constructor(private readonly onData: (value: string) => void) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.search(/[\r\n]/)) >= 0) {
      // A trailing CR might be the first half of a CRLF split across chunks.
      if (this.buffer[index] === '\r' && index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, index);
      const width = this.buffer[index] === '\r' && this.buffer[index + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(index + width);
      this.line(line);
    }
    if (this.buffer.length > 1000000) throw new ApiError('API 返回的事件过大。');
  }

  private line(line: string): void {
    if (line === '') {
      if (this.lines.length) this.onData(this.lines.join('\n'));
      this.lines = [];
    } else if (line.startsWith('data:')) this.lines.push(line.slice(5).replace(/^ /, ''));
  }

  finish(): void {
    if (this.buffer) this.line(this.buffer.replace(/\r$/, ''));
    this.buffer = ''; this.line('');
  }
}

interface ChatChunk {
  error?: unknown;
  choices?: { delta?: { content?: string }; message?: { content?: string }; finish_reason?: string | null }[];
}

function statusError(status: number, retryAfter: string | null): ApiError {
  const messages: Record<number, string> = {
    400: 'API 拒绝了请求，请检查模型名称、上下文长度和接口兼容性。',
    401: 'API Key 无效或已过期，请到设置中更新。',
    403: 'API 拒绝访问，请检查 Key 权限、余额或服务地区。',
    404: '未找到模型或接口，请检查 Base URL 与模型名称。',
    429: '请求过于频繁或额度不足，请稍后重试或降低并发。',
  };
  const seconds = Number(retryAfter);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter ?? '') - Date.now());
  return new ApiError(messages[status] ?? `模型服务暂时不可用（HTTP ${status}）。`, status === 429 || status >= 500, Math.min(delay || 0, 15000), [401, 403, 404].includes(status));
}

/** All fetches run in the service worker, never inside the content script.
 * Do not echo provider error bodies: gateways sometimes include credentials.
 */
export async function streamChat(
  profile: ModelProfile,
  messages: { role: 'system' | 'user'; content: string }[],
  signal: AbortSignal,
  onChunk: (value: string) => void,
  timeoutMs = 180000,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout>;
  const timeout = () => { timedOut = true; controller.abort(); };
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(timeout, Math.min(timeoutMs, 45000)); };
  const overallTimer = setTimeout(timeout, timeoutMs);
  touch();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (profile.apiKey.trim()) headers.Authorization = `Bearer ${profile.apiKey.trim()}`;
    const response = await fetch(completionUrl(profile.baseUrl), {
      method: 'POST', headers, body: JSON.stringify({ model: profile.model.trim(), messages, stream: true }),
      signal: controller.signal, credentials: 'omit', redirect: 'error',
    });
    if (!response.ok) throw statusError(response.status, response.headers.get('Retry-After'));
    let finished = false;
    let doneMarker = false;
    let gotText = false;
    let outputBytes = 0;
    const emit = (content: string) => {
      outputBytes += content.length;
      if (outputBytes > 1000000) throw new ApiError('模型返回内容过长，请减小批次。');
      if (content) { gotText = true; onChunk(content); }
    };
    const accept = (value: ChatChunk) => {
      if (value.error) throw new ApiError('模型服务返回了错误，请检查配置或稍后重试。');
      const choice = value.choices?.[0];
      if (choice?.finish_reason === 'length') throw new ApiError('译文被模型截断，请减小每批文本预算。');
      if (choice?.finish_reason === 'content_filter') throw new ApiError('该段内容未通过模型服务过滤，已保留原文。');
      if (choice?.finish_reason) finished = true;
      if (typeof choice?.delta?.content === 'string') emit(choice.delta.content);
      if (typeof choice?.message?.content === 'string') { emit(choice.message.content); finished = true; }
    };
    if (!response.body) throw new ApiError('API 没有返回可读取的响应。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let jsonBody = '';
    const isJson = response.headers.get('Content-Type')?.includes('application/json');
    const parser = new SseParser((data) => {
      if (data.trim() === '[DONE]') { finished = true; doneMarker = true; return; }
      try { accept(JSON.parse(data) as ChatChunk); } catch (error) {
        if (error instanceof SyntaxError) throw new ApiError('API 返回了无效的 SSE JSON。');
        throw error;
      }
    });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        touch();
        const text = decoder.decode(value, { stream: true });
        if (isJson) {
          jsonBody += text;
          if (jsonBody.length > 1000000) throw new ApiError('API 响应过大。');
        } else { parser.feed(text); if (doneMarker) break; }
      }
      const tail = decoder.decode();
      if (isJson) {
        try { accept(JSON.parse(jsonBody + tail) as ChatChunk); } catch (error) {
          if (error instanceof SyntaxError) throw new ApiError('API 返回了无效的 JSON。');
          throw error;
        }
      } else { parser.feed(tail); parser.finish(); }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (!gotText) throw new ApiError('API 未返回译文，请确认模型支持 Chat Completions。');
    if (!finished) throw new ApiError('响应在结束标记前中断，已保留原文。', true);
  } catch (error) {
    if (signal.aborted) throw new DOMException('已取消翻译', 'AbortError');
    if (timedOut) throw new ApiError('请求超时，请检查网络、服务地址或减小批次。', true);
    if (error instanceof TypeError) throw new ApiError('无法连接 API，请检查网络、Base URL 和本地模型服务。', true);
    throw error;
  } finally {
    clearTimeout(idleTimer!); clearTimeout(overallTimer);
    signal.removeEventListener('abort', abort);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}

export async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

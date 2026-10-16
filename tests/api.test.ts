import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SseParser, streamChat } from '../utils/api';
import { newProfile } from '../utils/defaults';
import { completionUrl } from '../utils/settings';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OpenAI-compatible transport', () => {
  it('normalizes bases without duplicating the endpoint', () => {
    expect(completionUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions');
    expect(completionUrl('http://localhost:11434/v1/chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
    expect(() => completionUrl('https://user:secret@example.com/v1')).toThrow();
    expect(() => completionUrl('https://example.com/v1?key=secret')).toThrow();
  });

  it('handles CRLF, comment heartbeats, multiple events and final unframed events', () => {
    const data: string[] = [];
    const parser = new SseParser((value) => data.push(value));
    for (const char of ': ping\r\ndata: one\r\n\r\ndata: two\ndata: three\n\ndata: [DONE]') parser.feed(char);
    parser.finish();
    expect(data).toEqual(['one', 'two\nthree', '[DONE]']);
  });

  it('accepts standalone CR separators, including a final CR', () => {
    const data: string[] = [];
    const parser = new SseParser((value) => data.push(value));
    for (const char of 'data: one\r\rdata: two\r\r') parser.feed(char);
    parser.finish(); expect(data).toEqual(['one', 'two']);
  });

  it('decodes UTF-8 across network chunks and omits auth for local services', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n');
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetcher);
    let output = '';
    await streamChat({ ...newProfile(), apiKey: '' }, [], new AbortController().signal, (value) => { output += value; });
    expect(output).toBe('你好');
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].headers).not.toHaveProperty('Authorization');
    expect(init[1].redirect).toBe('error');
  });

  it('rejects truncated SSE even if some content arrived', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')));
    await expect(streamChat(newProfile(), [], new AbortController().signal, () => undefined)).rejects.toThrow('结束标记');
  });

  it('supports compatible servers returning non-streaming JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] })));
    const output: string[] = [];
    await streamChat(newProfile(), [], new AbortController().signal, (value) => output.push(value));
    expect(output).toEqual(['OK']);
  });

  it('returns friendly 401 errors without exposing provider response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('sensitive provider diagnostics', { status: 401 })));
    await expect(streamChat(newProfile(), [], new AbortController().signal, () => undefined)).rejects.toThrow('API Key 无效');
  });

  it('recognizes retryable rate limiting with Retry-After', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3' } })));
    try { await streamChat(newProfile(), [], new AbortController().signal, () => undefined); throw new Error('expected rejection'); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).retryAfter).toBe(3000); expect((e as ApiError).retryable).toBe(true); }
  });

  it('aborts a stalled connection with a friendly timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const result = expect(streamChat(newProfile(), [], new AbortController().signal, () => undefined, 50)).rejects.toThrow('请求超时');
    await vi.advanceTimersByTimeAsync(51); await result;
  });

  it('propagates user cancellation rather than retrying it as a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const controller = new AbortController();
    const result = expect(streamChat(newProfile(), [], controller.signal, () => undefined)).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await result;
  });
});

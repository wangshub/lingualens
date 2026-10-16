import type { Segment, StreamEvent } from '../types';
import { ApiError, abortableDelay, errorMessage, streamChat } from './api';
import { activeProfile, loadSettings, renderPrompt, translationContext, validateProfile } from './settings';
import { batchSegments, encodeSegments, TRANSPORT_PROMPT, TranslationDecoder } from './protocol';
import { Semaphore } from './scheduler';

const globalSlots = new Semaphore(4);

export function validateSegments(value: unknown): asserts value is Segment[] {
  if (!Array.isArray(value) || !value.length || value.length > 20000) throw new Error('本次页面文本过多或为空，请缩小翻译范围。');
  const ids = new Set<string>();
  let bytes = 0;
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object') throw new Error('无效的翻译请求。');
    const s = entry as Record<string, unknown>;
    if (typeof s.id !== 'string' || !/^s\d+$/.test(s.id) || ids.has(s.id) || typeof s.groupId !== 'string' || !/^g\d+$/.test(s.groupId) || typeof s.text !== 'string' || !s.text.trim()) throw new Error('文本片段格式无效。');
    ids.add(s.id);
    bytes += new TextEncoder().encode(s.text).length;
    if (bytes > 4000000) throw new Error('单次文本超过 4 MB，请分区选中翻译。');
  }
}

/** Each batch is validated before a complete event is emitted. Failed paragraphs
 * are rolled back by the content controller, including their earlier batches.
 */
export async function translateSegments(segments: Segment[], signal: AbortSignal, send: (event: StreamEvent) => void, cacheKey?: string): Promise<void> {
  validateSegments(segments);
  const settings = await loadSettings();
  const profile = activeProfile(settings);
  validateProfile(profile);
  if (cacheKey && cacheKey !== await translationContext(profile)) throw new Error('模型配置已更新，请重新开始翻译。');
  const batches = batchSegments(segments, settings.batchBytes);
  const failedGroups = new Set<string>();
  let fatalError: unknown;
  let cursor = 0;
  const worker = async () => {
    while (!signal.aborted && !fatalError) {
      const batch = batches[cursor++];
      if (!batch) return;
      if (failedGroups.has(batch[0]!.groupId)) continue;
      const ids = batch.map((s) => s.id);
      try {
        await globalSlots.use(signal, async () => {
          for (let attempt = 0; ; attempt++) {
            if (signal.aborted) throw new DOMException('已取消', 'AbortError');
            if (failedGroups.has(batch[0]!.groupId)) return;
            const decoder = new TranslationDecoder(batch, (id, text) => { if (!signal.aborted) send({ type: 'delta', id, text }); });
            try {
              await streamChat(profile, [
                { role: 'system', content: renderPrompt(profile) + '\n\n' + TRANSPORT_PROMPT },
                { role: 'user', content: encodeSegments(batch) },
              ], signal, (text) => decoder.feed(text));
              decoder.finish();
              return;
            } catch (error) {
              if (signal.aborted || !(error instanceof ApiError) || !error.retryable || attempt >= 2) throw error;
              send({ type: 'reset', ids });
              await abortableDelay(Math.max(error.retryAfter, 1000 * 2 ** attempt) + Math.random() * 300, signal);
            }
          }
        });
        if (!signal.aborted) ids.forEach((id) => send({ type: 'complete', id }));
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ApiError && error.configurationError) {
          if (!fatalError) { fatalError = error; send({ type: 'fatal', error: error.message }); }
          return;
        }
        failedGroups.add(batch[0]!.groupId);
        // Include unscheduled pieces too so the paragraph is a single failed unit.
        const groupIds = segments.filter((s) => s.groupId === batch[0]!.groupId).map((s) => s.id);
        send({ type: 'failed', ids: groupIds, error: errorMessage(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, settings.concurrency)) }, worker));
  if (!signal.aborted && !fatalError) send({ type: 'finished' });
}

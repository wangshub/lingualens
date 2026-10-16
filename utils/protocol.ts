import type { Segment } from '../types';

export const TRANSPORT_PROMPT = `传输格式：用户给出 JSON Lines，每行是一个文本片段，id 用来对应原文。
结合相邻片段理解上下文，将每条 text 翻译为目标语言，保持片段边界和信息对应；不要合并、遗漏或重复片段。
每条结果严格输出一行 JSON：{"id":"原样返回的编号","text":"该片段的译文本身"}。
不要输出 Markdown 围栏、解释或其他字段；text 中的换行用 JSON 转义。JSON 外壳只用于传输，页面只显示 text。`;

export function encodeSegments(segments: Segment[]): string {
  return segments.map(({ id, text }) => JSON.stringify({ id, text })).join('\n');
}

/** UTF-8 bytes conservatively bound the source payload's byte-level token count.
 * System instructions and generated output consume extra model context separately.
 */
export function batchSegments(segments: Segment[], budget: number): Segment[][] {
  const batches: Segment[][] = [];
  let batch: Segment[] = [];
  let bytes = 0;
  for (const segment of segments) {
    const size = new TextEncoder().encode(encodeSegments([segment])).length + 1;
    if (size > budget) throw new Error('单个文本片段超出批次预算，请增加预算或缩小文本。');
    if (batch.length && (bytes + size > budget || batch[0]!.groupId !== segment.groupId)) {
      batches.push(batch); batch = []; bytes = 0;
    }
    batch.push(segment); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

// Decode only complete JSON characters, never expose partial escapes to the DOM.
function partialString(value: string): string {
  let end = value.length;
  const incomplete = /\\u[\da-fA-F]{0,3}$/.exec(value);
  if (incomplete) end = incomplete.index;
  let slashes = 0;
  for (let i = end - 1; i >= 0 && value[i] === '\\'; i--) slashes++;
  if (slashes % 2) end--;
  try { return JSON.parse('"' + value.slice(0, end) + '"') as string; } catch { return ''; }
}

/** Incremental JSONL parser with strict final validation and progressive text values.
 * A missing/duplicated/unknown id rejects the entire batch instead of misaligning DOM.
 */
export class TranslationDecoder {
  private buffer = '';
  private completed = new Set<string>();
  private readonly expected: Set<string>;
  constructor(segments: Segment[], private readonly onText: (id: string, text: string) => void) {
    this.expected = new Set(segments.map((segment) => segment.id));
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 200000) throw new Error('模型返回的单行译文过长。');
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      this.line(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
    }
    // The protocol explicitly requests id before text; other valid key orders
    // still work on the final line, just without partial rendering.
    const match = /^\s*\{\s*"id"\s*:\s*"([^"\\]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)$/s.exec(this.buffer);
    if (match && this.expected.has(match[1]!) && !this.completed.has(match[1]!)) this.onText(match[1]!, partialString(match[2]!));
  }

  private line(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error('模型没有返回约定的 JSON Lines，请重试或更换模型。'); }
    if (!value || typeof value !== 'object') throw new Error('译文格式无效。');
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.text !== 'string' || !record.text.trim() || !this.expected.has(record.id) || this.completed.has(record.id)) {
      throw new Error('模型返回了缺失、重复或无效的文本编号，已保留原文。');
    }
    this.completed.add(record.id);
    this.onText(record.id, record.text.trim());
  }

  finish(): void {
    this.line(this.buffer); this.buffer = '';
    if (this.completed.size !== this.expected.size) throw new Error('模型遗漏了部分片段，已保留原文，请重试。');
  }
}

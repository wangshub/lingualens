import { describe, expect, it } from 'vitest';
import { batchSegments, encodeSegments, TranslationDecoder } from '../utils/protocol';
import type { Segment } from '../types';

const segments: Segment[] = [{ id: 's0', groupId: 'g0', text: 'Hello' }, { id: 's1', groupId: 'g0', text: 'world' }];

describe('translation wire protocol', () => {
  it('streams escaped Unicode without leaking JSON syntax into the page', () => {
    const values = new Map<string, string>();
    const parser = new TranslationDecoder(segments, (id, text) => values.set(id, text));
    parser.feed('{"id":"s0","text":"你');
    expect(values.get('s0')).toBe('你');
    parser.feed('好\\u4e');
    expect(values.get('s0')).toBe('你好');
    parser.feed('16\\n\\"界\\""}\n{"id":"s1","text":"世界"}');
    parser.finish();
    expect(values.get('s0')).toBe('你好世\n"界"');
    expect(values.get('s1')).toBe('世界');
  });

  it.each([
    '{"id":"s0","text":"你好"}',
    '{"id":"s0","text":"你好"}\n{"id":"s0","text":"重复"}',
    '{"id":"unknown","text":"无对应原文"}',
    '```json\n{"id":"s0","text":"你好"}\n```',
  ])('rejects missing, duplicated, unknown ids and Markdown (%s)', (response) => {
    const parser = new TranslationDecoder(segments, () => undefined);
    expect(() => { parser.feed(response); parser.finish(); }).toThrow();
  });

  it('enforces the encoded UTF-8 budget and keeps paragraphs separate', () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, groupId: i < 6 ? 'g0' : 'g1', text: '中文"\\\n'.repeat(10) }));
    const batches = batchSegments(list, 400);
    expect(batches.flat()).toEqual(list);
    for (const batch of batches) {
      expect(new TextEncoder().encode(encodeSegments(batch)).length).toBeLessThanOrEqual(400);
      expect(new Set(batch.map((s) => s.groupId)).size).toBe(1);
    }
  });
});

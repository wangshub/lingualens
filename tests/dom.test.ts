import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectText, splitSlice } from '../utils/dom';
import { TranslationController } from '../utils/translation-controller';
import type { Segment, StreamEvent } from '../types';
import type { TranslationTransport } from '../utils/content-transport';

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ width: 10, height: 10 }] });
});

function harness() {
  let receive: (event: StreamEvent) => void = () => undefined;
  let segments: Segment[] = [];
  const cancel = vi.fn();
  const transport: TranslationTransport = (input, handler) => { segments = input; receive = handler; return cancel; };
  const controller = new TranslationController(transport, () => undefined);
  return { controller, cancel, get segments() { return segments; }, emit: (event: StreamEvent) => receive(event) };
}

describe('DOM translation and restoration', () => {
  it('keeps inline nodes, hrefs, event handlers, spacing, and exact original text', () => {
    document.body.innerHTML = '<p>  Hello <strong>world</strong> <a href="/more">read more</a>! </p>';
    const strong = document.querySelector('strong')!;
    const link = document.querySelector('a')!;
    const clicked = vi.fn(); link.addEventListener('click', clicked);
    const original = document.body.innerHTML;
    const h = harness(); h.controller.page();
    for (const [i, s] of h.segments.entries()) { h.emit({ type: 'delta', id: s.id, text: ['你好', '世界', '阅读更多'][i]! }); h.emit({ type: 'complete', id: s.id }); }
    h.emit({ type: 'finished' });
    expect(document.querySelector('strong')).toBe(strong);
    expect(document.querySelector('a')).toBe(link);
    link.dispatchEvent(new Event('click')); expect(clicked).toHaveBeenCalledOnce();
    expect(link.getAttribute('href')).toBe('/more');
    expect(document.querySelector('p')!.textContent).toBe('  你好 世界 阅读更多! ');
    h.controller.restore(); expect(document.body.innerHTML).toBe(original);
  });

  it('replaces only a partial selection spanning inline elements', () => {
    document.body.innerHTML = '<p>Before hello <strong>world</strong> after.</p>';
    const p = document.querySelector('p')!;
    const range = document.createRange(); range.setStart(p.firstChild!, 7); range.setEnd(p.querySelector('strong')!.firstChild!, 3);
    const h = harness(); h.controller.selection([range]);
    expect(h.segments.map((s) => s.text)).toEqual(['hello', 'wor']);
    h.segments.forEach((s, i) => h.emit({ type: 'delta', id: s.id, text: ['你好', '世'][i]! }));
    expect(p.textContent).toBe('Before 你好 世ld after.');
    h.controller.restore(); expect(p.textContent).toBe('Before hello world after.');
  });

  it('filters code, editable regions, hidden ancestors and translate=no', () => {
    document.body.innerHTML = '<p>Visible</p><pre>code</pre><div hidden><span>hidden</span></div><div style="display:none"><p>none</p></div><div contenteditable="true">draft</div><span translate="no">skip</span><script>const value = 1</script><style>p{color:red}</style>';
    expect(collectText().map((s) => s.node.data)).toEqual(['Visible']);
  });

  it('restores a whole paragraph after one of its fragments fails', () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong></p><p>Other</p>';
    const h = harness(); h.controller.page();
    h.emit({ type: 'delta', id: 's0', text: '你好' }); h.emit({ type: 'complete', id: 's0' });
    h.emit({ type: 'delta', id: 's1', text: '世' });
    h.emit({ type: 'failed', ids: ['s1'], error: 'API Key 无效' });
    expect(document.querySelector('p')!.textContent).toBe('Hello world');
    h.emit({ type: 'delta', id: 's1', text: '迟到的译文' });
    expect(document.querySelector('p')!.textContent).toBe('Hello world');
    h.emit({ type: 'delta', id: 's2', text: '其他' }); h.emit({ type: 'complete', id: 's2' }); h.emit({ type: 'finished' });
    expect(h.controller.status).toMatchObject({ completed: 1, failed: 1 });
    h.controller.retry('g0'); expect(h.segments.map((s) => s.id)).toEqual(['s0', 's1']);
  });

  it('cancels requests and ignores late packets after restoring', () => {
    document.body.innerHTML = '<p>Hello</p>';
    const h = harness(); h.controller.page(); h.emit({ type: 'delta', id: 's0', text: '你好' });
    h.controller.restore(); h.emit({ type: 'delta', id: 's0', text: '迟到' });
    expect(document.body.textContent).toBe('Hello'); expect(h.cancel).toHaveBeenCalledOnce();
  });

  it('preserves a framework update and rolls back the other inline fragments', () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong></p>';
    const h = harness(); h.controller.page(); h.emit({ type: 'delta', id: 's0', text: '你好' });
    const node = document.querySelector('strong')!.firstChild!;
    node.textContent = 'Updated by React';
    h.emit({ type: 'delta', id: 's1', text: '世界' });
    expect(document.querySelector('p')!.textContent).toBe('Hello Updated by React');
    h.emit({ type: 'delta', id: 's1', text: '再来' }); h.controller.restore();
    expect(node.textContent).toBe('Updated by React');
  });

  it('never splits surrogate pairs and respects the escaped payload bound', () => {
    document.body.innerHTML = '<p></p>';
    const node = document.createTextNode('你好😀"\\\n'.repeat(400)); document.querySelector('p')!.append(node);
    const parts = splitSlice({ node, start: 0, end: node.length, block: node.parentElement! });
    let reconstructed = ''; let offset = 0;
    for (const p of parts) { reconstructed += node.data.slice(offset, p.start) + p.text; offset = p.end; }
    reconstructed += node.data.slice(offset);
    expect(reconstructed).toBe(node.data);
    for (const p of parts) { expect(new TextEncoder().encode(JSON.stringify(p.text)).length).toBeLessThanOrEqual(802); expect(p.text).not.toMatch(/[\uD800-\uDBFF]$/u); }
  });
});

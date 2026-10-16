import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationController } from '../utils/translation-controller';
import { collectText } from '../utils/dom';
import type { Segment, StreamEvent } from '../types';

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ width: 10, height: 10 }] });
});

function harness() {
  const calls: { segments: Segment[]; receive: (event: StreamEvent) => void }[] = [];
  const cancel = vi.fn();
  const controller = new TranslationController((segments, receive) => { calls.push({ segments, receive }); return cancel; }, () => undefined);
  const latest = () => calls.at(-1)!;
  const complete = () => {
    for (const s of latest().segments) { latest().receive({ type: 'delta', id: s.id, text: `中:${s.text}` }); latest().receive({ type: 'complete', id: s.id }); }
    latest().receive({ type: 'finished' });
  };
  return { controller, calls, cancel, complete, latest };
}

function translation(element: Element): HTMLElement | null {
  return element.querySelector<HTMLElement>('[data-lingualens-translation]');
}

describe('retained translations and bilingual display', () => {
  it('switches original/translated/bilingual repeatedly without another API request', () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong>.</p>';
    const original = document.body.innerHTML;
    const strong = document.querySelector('strong')!;
    const h = harness(); h.controller.page('profile-a'); h.complete();
    for (let i = 0; i < 3; i++) {
      h.controller.restore(); expect(document.body.innerHTML).toBe(original);
      expect(h.controller.status).toMatchObject({ viewMode: 'original', cached: 1 });
      h.controller.show('translated', 'profile-a'); expect(document.querySelector('p')!.textContent).toBe('中:Hello 中:world.');
      h.controller.show('bilingual', 'profile-a');
      expect(document.querySelector('p')!.textContent).toBe('Hello world.');
      expect(document.querySelector('p')!.lastChild).toBe(translation(document.querySelector('p')!));
      expect(translation(document.querySelector('p')!)!.shadowRoot!.textContent).toContain('中:Hello 中:world.');
    }
    expect(document.querySelector('strong')).toBe(strong);
    expect(h.calls).toHaveLength(1);
    h.controller.restore(); h.controller.page('profile-a'); expect(h.calls).toHaveLength(1);
  });

  it('streams below original text and preserves inline links, emphasis and code safely', () => {
    document.body.innerHTML = '<p id="source">Read <a id="source-link" href="/docs" onclick="bad()"><strong>the docs</strong></a> with <code>foo()</code> in 2026.</p>';
    const p = document.querySelector('p')!;
    const link = document.querySelector('a')!;
    const originalText = p.textContent;
    const h = harness(); h.controller.page('a', 'bilingual');
    const first = h.latest().segments[0]!;
    h.latest().receive({ type: 'delta', id: first.id, text: '<img src=x onerror=bad()>阅读' });
    expect(p.textContent).toBe(originalText);
    const shadow = translation(p)!.shadowRoot!;
    expect(shadow.querySelector('img')).toBeNull();
    expect(shadow.querySelector('section')!.textContent).toContain('<img src=x onerror=bad()>阅读');
    h.complete();
    expect(shadow.querySelector('a')!.getAttribute('href')).toBe(new URL('/docs', document.baseURI).href);
    expect(shadow.querySelector('a')!.hasAttribute('onclick')).toBe(false);
    expect(shadow.querySelector('[id]')).toBeNull();
    expect(shadow.querySelector('strong')!.textContent).toBe('中:the docs');
    expect(shadow.querySelector('code')!.textContent).toBe('foo()');
    expect(document.querySelector('a')).toBe(link);
    expect(collectText().map((s) => s.node.data)).not.toContain('中:the docs');
    h.controller.restore(); expect(translation(p)).toBeNull(); expect(p.textContent).toBe(originalText);
  });

  it('keeps list and table structure valid, with the translation inside its paragraph', () => {
    document.body.innerHTML = '<ul><li>Alpha</li></ul><table><tbody><tr><td>Beta</td></tr></tbody></table>';
    const original = document.body.innerHTML;
    const h = harness(); h.controller.page('a', 'bilingual'); h.complete();
    for (const element of document.querySelectorAll('li,td')) {
      const host = translation(element)!;
      expect(host.tagName).toBe('SPAN'); expect(host.parentElement).toBe(element);
      expect(host.shadowRoot!.querySelector('section')!.textContent).toContain('中:');
    }
    h.controller.restore(); expect(document.body.innerHTML).toBe(original);
  });

  it('retains completed paragraphs when cancelling and rejects late packets', () => {
    document.body.innerHTML = '<p>Alpha</p><p>Beta</p>';
    const h = harness(); h.controller.page('a');
    const request = h.latest(); const [a, b] = request.segments;
    request.receive({ type: 'delta', id: a!.id, text: '甲' }); request.receive({ type: 'complete', id: a!.id });
    request.receive({ type: 'delta', id: b!.id, text: '未完成' });
    h.controller.restore(); request.receive({ type: 'delta', id: b!.id, text: '迟到内容' });
    expect(document.body.textContent).toBe('AlphaBeta');
    h.controller.show('translated', 'a');
    expect(document.body.textContent).toBe('甲Beta'); expect(h.calls).toHaveLength(1);
    h.controller.page('a'); expect(h.latest().segments.map((s) => s.text)).toEqual(['Beta']);
    expect(h.calls).toHaveLength(2);
  });

  it('reuses cached paragraphs and translates only newly added content', () => {
    document.body.innerHTML = '<p>Alpha</p>';
    const h = harness(); h.controller.page('a'); h.complete(); h.controller.restore();
    const next = document.createElement('p'); next.textContent = 'Beta'; document.body.append(next);
    h.controller.page('a'); expect(h.latest().segments.map((s) => s.text)).toEqual(['Beta']); h.complete();
    expect(document.body.textContent).toBe('中:Alpha中:Beta'); expect(h.controller.status.cached).toBe(2);
  });

  it('expires cached text on a context change and supports explicit retranslation', () => {
    document.body.innerHTML = '<p>Alpha</p>';
    const h = harness(); h.controller.page('a'); h.complete(); h.controller.restore();
    h.controller.show('translated', 'b');
    expect(document.body.textContent).toBe('Alpha'); expect(h.controller.status.cached).toBe(0); expect(h.calls).toHaveLength(1);
    h.controller.page('b'); expect(h.calls).toHaveLength(2); h.complete();
    h.controller.page('b', undefined, true); expect(h.calls).toHaveLength(3);
  });

  it('does not overwrite external edits and refreshes only the changed paragraph', () => {
    document.body.innerHTML = '<p>Alpha</p><p>Beta</p>';
    const h = harness(); h.controller.page('a'); h.complete(); h.controller.restore();
    document.querySelector('p')!.firstChild!.textContent = 'Updated';
    h.controller.show('bilingual', 'a');
    expect(document.querySelector('p')!.textContent).toBe('Updated'); expect(translation(document.querySelector('p')!)).toBeNull();
    h.controller.page('a'); expect(h.latest().segments.map((s) => s.text)).toEqual(['Updated']);
    h.complete(); expect(h.controller.status.cached).toBe(2);
  });

  it('invalidates translations when source nodes are inserted or replaced', () => {
    document.body.innerHTML = '<p>Alpha</p>';
    const h = harness(); h.controller.page('a'); h.complete(); h.controller.restore();
    const p = document.querySelector('p')!; p.append(document.createTextNode(' added'));
    h.controller.show('bilingual', 'a');
    expect(translation(p)).toBeNull(); expect(p.textContent).toBe('Alpha added');
    h.controller.page('a'); expect(h.latest().segments.map((s) => s.text)).toEqual(['Alpha', 'added']);
  });

  it('accumulates non-overlapping selections in the same paragraph', () => {
    document.body.innerHTML = '<p>Alpha and Beta</p>';
    const node = document.querySelector('p')!.firstChild!;
    const first = document.createRange(); first.setStart(node, 0); first.setEnd(node, 5);
    const h = harness(); h.controller.selection([first], 'a'); h.complete(); h.controller.restore();
    const second = document.createRange(); second.setStart(node, 10); second.setEnd(node, 14);
    h.controller.selection([second], 'a'); expect(h.latest().segments.map((s) => s.text)).toEqual(['Beta']); h.complete();
    expect(node.textContent).toBe('中:Alpha and 中:Beta');
    h.controller.restore(); h.controller.show('translated', 'a');
    expect(node.textContent).toBe('中:Alpha and 中:Beta'); expect(h.calls).toHaveLength(2);
  });

  it('expires a paragraph when an untranslated number node changes', () => {
    document.body.innerHTML = '<p>There are <span>12</span> items.</p>';
    const h = harness(); h.controller.page('a'); h.complete(); h.controller.restore();
    document.querySelector('span')!.firstChild!.textContent = '27';
    h.controller.show('bilingual', 'a');
    expect(translation(document.querySelector('p')!)).toBeNull();
    expect(document.querySelector('p')!.textContent).toBe('There are 27 items.');
    expect(h.controller.status.cached).toBe(0);
  });

  it('rolls back an invalid bilingual response and can retry that paragraph', () => {
    document.body.innerHTML = '<p>Alpha <strong>Beta</strong></p>';
    const h = harness(); h.controller.page('a', 'bilingual');
    h.latest().receive({ type: 'delta', id: h.latest().segments[0]!.id, text: '甲' });
    expect(translation(document.querySelector('p')!)).not.toBeNull();
    h.latest().receive({ type: 'failed', ids: [h.latest().segments[0]!.id], error: 'invalid response' });
    h.latest().receive({ type: 'finished' });
    expect(translation(document.querySelector('p')!)).toBeNull(); expect(document.body.textContent).toBe('Alpha Beta');
    h.controller.retry(); h.complete();
    expect(translation(document.querySelector('p')!)!.shadowRoot!.querySelector('section')!.textContent).toBe('中:Alpha 中:Beta');
  });

  it('releases original and translated snapshots only when disposing the page session', () => {
    document.body.innerHTML = '<p>Alpha</p>';
    const h = harness(); h.controller.page('a', 'bilingual'); h.complete(); h.controller.dispose();
    expect(document.body.innerHTML).toBe('<p>Alpha</p>');
    expect(h.controller.status).toMatchObject({ total: 0, cached: 0, viewMode: 'original' });
  });
});

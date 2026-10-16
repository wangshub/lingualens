import type { PageStatus, Segment, StreamEvent, TranslationMode, ViewMode } from '../types';
import type { TranslationTransport } from './content-transport';
import { collectText, FAILED_CLASS, PENDING_CLASS, splitSlice, type TextSlice } from './dom';
import { BilingualRenderer, sourceStructure } from './bilingual';

interface CachedNode { original: string; lastWritten: string }
interface Unit extends Segment { node: Text; start: number; end: number; translated?: string; done: boolean }
interface Stage { base: string; units: Unit[] }
export interface Paragraph {
  id: string; element: Element; hadClass: boolean; units: Unit[];
  structure: ReturnType<typeof sourceStructure>;
  state: 'pending' | 'completed' | 'failed'; error?: string; preview: string;
}

/** Originals and completed translations survive display changes for this page.
 * Rendering, cancellation and cache disposal are deliberately separate actions.
 */
export class TranslationController {
  private cache = new Map<Text, CachedNode>();
  private stages = new Map<Text, Stage>();
  private units = new Map<string, Unit>();
  readonly paragraphs = new Map<string, Paragraph>();
  private bilingual = new BilingualRenderer();
  private cancel?: () => void;
  private epoch = 0;
  private running = false;
  private message = '';
  private cacheKey = '';
  private mode: ViewMode = 'original';
  private preferredMode: TranslationMode = 'translated';
  private nextUnit = 0;
  private nextGroup = 0;
  constructor(private readonly transport: TranslationTransport, private readonly changed: () => void) {}

  get status(): PageStatus {
    const values = [...this.paragraphs.values()];
    const completed = values.filter((p) => p.state === 'completed').length;
    return { busy: this.running, total: values.length, completed, failed: values.filter((p) => p.state === 'failed').length, viewMode: this.mode, cached: completed, message: this.message };
  }

  /** Expire a different model/language/prompt without exposing its credentials. */
  refreshContext(cacheKey: string): void {
    if (this.cacheKey && this.cacheKey !== cacheKey) {
      this.dispose(); this.message = '翻译设置已更新，请重新翻译。'; this.changed();
    }
    this.cacheKey = cacheKey;
    for (const p of this.paragraphs.values()) if (p.state !== 'failed' && !this.isCurrent(p)) this.invalidate(p);
  }

  page(cacheKey = 'default', mode?: TranslationMode, force = false): void {
    const desired = mode ?? this.preferredMode;
    this.refreshContext(cacheKey);
    if (this.running && !force) { this.show(desired); return; }
    if (force) { this.dispose(); this.cacheKey = cacheKey; }
    this.bilingual.clear(); this.writeOriginals(); this.clearMarkers();
    this.pruneInvalid();
    this.prepare(collectText(), desired);
  }

  selection(ranges: Range[], cacheKey = 'default'): void {
    if (this.running) throw new Error('正在翻译，请等待完成，或先还原原文再重新选中。');
    const slices = collectText(document.body, ranges);
    if (slices.some(({ node }) => { const c = this.cache.get(node); return c && node.data !== c.original; })) {
      throw new Error('请先切换到原文，再选中需要翻译的内容。');
    }
    this.refreshContext(cacheKey);
    this.bilingual.clear(); this.writeOriginals(); this.clearMarkers(); this.pruneInvalid();
    this.prepare(slices, this.preferredMode);
  }

  private prepare(slices: TextSlice[], mode: TranslationMode): void {
    if (!slices.length) throw new Error('没有找到可翻译的可见文本。代码、输入框和不可见内容会被跳过。');
    const blocks = new Map([...this.paragraphs.values()].map((p) => [p.element, p]));
    const requested = new Set<Paragraph>();
    for (const slice of slices) {
      let paragraph = blocks.get(slice.block);
      if (!paragraph) {
        paragraph = { id: `g${this.nextGroup++}`, element: slice.block, hadClass: slice.block.hasAttribute('class'), units: [], structure: sourceStructure(slice.block), state: 'pending', preview: '' };
        blocks.set(slice.block, paragraph); this.paragraphs.set(paragraph.id, paragraph);
      }
      let stage = this.stages.get(slice.node);
      if (!stage) {
        stage = { base: slice.node.data, units: [] }; this.stages.set(slice.node, stage);
        this.cache.set(slice.node, { original: slice.node.data, lastWritten: slice.node.data });
      }
      if (this.covered(stage, slice.start, slice.end)) continue;
      // Expand an overlapping selection to existing source boundaries. A cached
      // translation cannot be cut into words using source-language offsets.
      let start = slice.start; let end = slice.end;
      let expanded: boolean;
      do {
        expanded = false;
        for (const u of stage.units) if (u.start < end && u.end > start && (u.start < start || u.end > end)) {
          start = Math.min(start, u.start); end = Math.max(end, u.end); expanded = true;
        }
      } while (expanded);
      const overlapping = stage.units.filter((u) => u.start < end && u.end > start);
      for (const u of overlapping) this.units.delete(u.id);
      stage.units = stage.units.filter((u) => !overlapping.includes(u));
      paragraph.units = paragraph.units.filter((u) => !overlapping.includes(u));
      for (const part of splitSlice({ ...slice, start, end })) {
        const unit: Unit = { id: `s${this.nextUnit++}`, groupId: paragraph.id, node: slice.node, ...part, done: false };
        paragraph.units.push(unit); stage.units.push(unit); this.units.set(unit.id, unit);
      }
      paragraph.state = 'pending'; paragraph.error = undefined;
      paragraph.preview = paragraph.units.map((u) => u.text).join(' ');
      requested.add(paragraph);
    }
    this.mode = mode; this.preferredMode = mode;
    this.renderAll();
    if (requested.size) this.start([...requested]);
    else { this.message = '已显示缓存译文'; this.markers(); this.changed(); }
  }

  private covered(stage: Stage, start: number, end: number): boolean {
    let cursor = start;
    for (const u of [...stage.units].sort((a, b) => a.start - b.start)) {
      if (!u.done || u.translated === undefined || u.end <= cursor || u.start >= end) continue;
      if (stage.base.slice(cursor, u.start).trim()) return false;
      cursor = Math.max(cursor, u.end);
      if (cursor >= end) return true;
    }
    return !stage.base.slice(cursor, end).trim();
  }

  show(mode: ViewMode, cacheKey?: string): void {
    if (mode === 'original') { this.restore(); return; }
    if (cacheKey) this.refreshContext(cacheKey);
    this.mode = mode; this.preferredMode = mode;
    this.renderAll(); this.markers();
    this.message = this.running ? '正在翻译' : this.status.cached ? mode === 'bilingual' ? '已显示双语对照' : '已显示缓存译文' : '请先翻译当前页面';
    this.changed();
  }

  retry(groupId?: string): void {
    if (this.running) throw new Error('请等待当前翻译结束后重试。');
    const paragraphs = [...this.paragraphs.values()].filter((p) => p.state === 'failed' && (!groupId || p.id === groupId));
    if (!paragraphs.length) throw new Error('没有需要重试的段落。');
    for (const p of paragraphs) if (!this.isCurrent(p)) throw new Error('页面已更新，请重新翻译当前页面。');
    for (const p of paragraphs) {
      for (const unit of p.units) { unit.done = false; unit.translated = undefined; }
      p.state = 'pending'; p.error = undefined;
    }
    this.mode = this.preferredMode; this.start(paragraphs);
  }

  private start(paragraphs: Paragraph[]): void {
    this.running = true; this.message = '正在翻译';
    const epoch = ++this.epoch;
    this.markers(); this.changed();
    try {
      this.cancel = this.transport(paragraphs.flatMap((p) => p.units.filter((u) => !u.done).map(({ id, groupId, text }) => ({ id, groupId, text }))), (event) => {
        if (epoch !== this.epoch) return;
        this.receive(event);
      }, this.cacheKey);
    } catch (error) { this.receive({ type: 'fatal', error: error instanceof Error ? error.message : '无法连接翻译后台。' }); }
  }

  private receive(event: StreamEvent): void {
    if (event.type === 'pong') return;
    if (event.type === 'delta' || event.type === 'complete') {
      const unit = this.units.get(event.id);
      if (!unit) return;
      const p = this.paragraphs.get(unit.groupId)!;
      if (p.state !== 'pending') return;
      if (!this.isCurrent(p)) { this.invalidate(p); return; }
      if (event.type === 'delta') { unit.translated = event.text; this.renderParagraph(p); return; }
      unit.done = true;
      if (p.units.every((u) => u.done && u.translated !== undefined)) p.state = 'completed';
    } else if (event.type === 'reset') {
      const dirty = new Set<Paragraph>();
      for (const id of event.ids) {
        const u = this.units.get(id); const p = u && this.paragraphs.get(u.groupId);
        if (u && p?.state === 'pending') { u.translated = undefined; u.done = false; dirty.add(p); }
      }
      dirty.forEach((p) => this.renderParagraph(p));
    } else if (event.type === 'failed') {
      for (const group of new Set(event.ids.map((id) => this.units.get(id)?.groupId))) if (group) this.fail(this.paragraphs.get(group)!, event.error);
    } else if (event.type === 'fatal') {
      for (const p of this.paragraphs.values()) if (p.state === 'pending') this.fail(p, event.error);
      this.running = false; this.message = event.error;
    } else if (event.type === 'finished') {
      for (const p of this.paragraphs.values()) if (p.state === 'pending') this.fail(p, '响应缺少完整译文，请重试。');
      this.running = false;
      this.message = this.status.failed ? '部分段落翻译失败，已保留原文' : '翻译完成';
    }
    this.markers(); this.changed();
  }

  private isCurrent(p: Paragraph): boolean {
    if (!p.element.isConnected) return false;
    for (const u of p.units) {
      const cached = this.cache.get(u.node);
      if (!cached || !u.node.isConnected || u.node.data !== cached.lastWritten) return false;
    }
    const structure = sourceStructure(p.element);
    return structure.length === p.structure.length && structure.every((s, i) => {
      const previous = p.structure[i]!;
      return s.node === previous.node && s.parent === previous.parent && s.node.data === (this.cache.get(s.node)?.lastWritten ?? previous.source);
    });
  }

  private invalidate(p: Paragraph): void {
    for (const u of p.units) {
      const c = this.cache.get(u.node);
      if (c && (!u.node.isConnected || u.node.data !== c.lastWritten)) this.cache.delete(u.node);
    }
    this.fail(p, '页面内容已更新，请重新翻译。'); this.markers(); this.changed();
  }

  private fail(p: Paragraph, error: string): void {
    p.state = 'failed'; p.error = error;
    for (const unit of p.units) { unit.translated = undefined; unit.done = false; }
    this.bilingual.remove(p.element);
    for (const node of new Set(p.units.map((u) => u.node))) this.writeOriginal(node);
  }

  private translatedValue(node: Text): string {
    const stage = this.stages.get(node);
    if (!stage) return node.data;
    let text = ''; let cursor = 0;
    for (const u of [...stage.units].sort((a, b) => a.start - b.start)) {
      text += stage.base.slice(cursor, u.start) + (u.translated ?? stage.base.slice(u.start, u.end)); cursor = u.end;
    }
    return text + stage.base.slice(cursor);
  }

  private renderParagraph(p: Paragraph): void {
    if (!this.isCurrent(p)) { if (p.state !== 'failed') this.invalidate(p); return; }
    const owned = new Set(p.units.map((u) => u.node));
    for (const node of owned) {
      const c = this.cache.get(node)!;
      const text = this.mode === 'translated' ? this.translatedValue(node) : c.original;
      node.data = text; c.lastWritten = text;
    }
    if (this.mode === 'bilingual' && p.state !== 'failed' && p.units.some((u) => u.translated?.trim())) this.bilingual.update(p.element, p.id, owned, (node) => this.translatedValue(node));
    else this.bilingual.remove(p.element);
  }

  private renderAll(): void { for (const p of this.paragraphs.values()) this.renderParagraph(p); }
  private writeOriginal(node: Text): boolean {
    const c = this.cache.get(node);
    if (!c || !node.isConnected || node.data !== c.lastWritten) return false;
    node.data = c.original; c.lastWritten = c.original; return true;
  }
  private writeOriginals(): number { let count = 0; for (const node of this.cache.keys()) if (this.writeOriginal(node)) count++; return count; }

  private pruneInvalid(): void {
    for (const p of this.paragraphs.values()) if (!this.isCurrent(p)) {
      this.bilingual.remove(p.element);
      for (const u of p.units) { this.units.delete(u.id); this.cache.delete(u.node); this.stages.delete(u.node); }
      this.paragraphs.delete(p.id);
    }
  }

  private clearMarkers(): void {
    for (const p of this.paragraphs.values()) {
      if (p.element.classList.contains(PENDING_CLASS) || p.element.classList.contains(FAILED_CLASS)) p.element.classList.remove(PENDING_CLASS, FAILED_CLASS);
      if (!p.hadClass && p.element.getAttribute('class') === '') p.element.removeAttribute('class');
    }
  }
  private markers(): void {
    this.clearMarkers();
    if (this.mode === 'original') return;
    for (const p of this.paragraphs.values()) {
      if (p.state === 'pending' && this.running) p.element.classList.add(PENDING_CLASS);
      if (p.state === 'failed') p.element.classList.add(FAILED_CLASS);
    }
  }

  /** Cancel incomplete work, but keep completed translations for instant reuse. */
  restore(notify = true): number {
    this.epoch++; this.cancel?.(); this.cancel = undefined; this.running = false;
    for (const p of this.paragraphs.values()) if (p.state === 'pending') {
      for (const u of p.units) if (!u.done) u.translated = undefined;
      // Only a whole validated paragraph is reusable after cancellation.
      if (!p.units.every((u) => u.done)) for (const u of p.units) { u.translated = undefined; u.done = false; }
    }
    this.mode = 'original'; this.bilingual.clear();
    const restored = this.writeOriginals(); this.clearMarkers();
    this.message = this.status.cached ? '已还原原文，译文已保留' : `已还原原文（${restored} 个文本节点）`;
    if (notify) this.changed();
    return restored;
  }

  /** Navigation, extension invalidation and explicit retranslation release data. */
  dispose(): void {
    this.restore(false); this.cache.clear(); this.stages.clear(); this.units.clear(); this.paragraphs.clear();
    this.cacheKey = ''; this.nextUnit = 0; this.nextGroup = 0;
  }
}

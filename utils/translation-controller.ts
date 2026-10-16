import type { PageStatus, Segment, StreamEvent } from '../types';
import type { TranslationTransport } from './content-transport';
import { collectText, FAILED_CLASS, PENDING_CLASS, splitSlice, type TextSlice } from './dom';

interface CachedNode { original: string; lastWritten: string }
interface Unit extends Segment { node: Text; start: number; end: number; translated?: string; done: boolean }
interface Stage { base: string; units: Unit[] }
export interface Paragraph { id: string; element: Element; hadClass: boolean; units: Unit[]; state: 'pending' | 'completed' | 'failed'; error?: string; preview: string }

export class TranslationController {
  private cache = new Map<Text, CachedNode>();
  private stages = new Map<Text, Stage>();
  private units = new Map<string, Unit>();
  readonly paragraphs = new Map<string, Paragraph>();
  private cancel?: () => void;
  private epoch = 0;
  private running = false;
  private message = '';
  constructor(private readonly transport: TranslationTransport, private readonly changed: () => void) {}

  get status(): PageStatus {
    const values = [...this.paragraphs.values()];
    return { busy: this.running, total: values.length, completed: values.filter((p) => p.state === 'completed').length, failed: values.filter((p) => p.state === 'failed').length, message: this.message };
  }

  page(): void {
    if (this.running) throw new Error('正在翻译，可先还原原文以取消当前任务。');
    this.restore(false);
    this.prepare(collectText());
  }

  selection(ranges: Range[]): void {
    if (this.running) throw new Error('正在翻译，请等待完成，或先还原原文再重新选中。');
    this.prepare(collectText(document.body, ranges));
  }

  private prepare(slices: TextSlice[]): void {
    if (!slices.length) throw new Error('没有找到可翻译的可见文本。代码、输入框和不可见内容会被跳过。');
    // A new selection may cover already translated nodes. Cache the first
    // original, but use current text as this operation's offset coordinate base.
    this.clearMarkers();
    this.stages.clear(); this.units.clear(); this.paragraphs.clear();
    const blocks = new Map<Element, Paragraph>();
    let unitId = 0;
    for (const slice of slices) {
      let paragraph = blocks.get(slice.block);
      if (!paragraph) {
        paragraph = { id: `g${blocks.size}`, element: slice.block, hadClass: slice.block.hasAttribute('class'), units: [], state: 'pending', preview: '' };
        blocks.set(slice.block, paragraph); this.paragraphs.set(paragraph.id, paragraph);
      }
      let stage = this.stages.get(slice.node);
      if (!stage) {
        stage = { base: slice.node.data, units: [] };
        this.stages.set(slice.node, stage);
        // If a framework edited this node, its new text becomes the new source;
        // never restore a stale value over a live application update.
        const old = this.cache.get(slice.node);
        if (!old || old.lastWritten !== slice.node.data) this.cache.set(slice.node, { original: slice.node.data, lastWritten: slice.node.data });
      }
      for (const part of splitSlice(slice)) {
        const unit: Unit = { id: `s${unitId++}`, groupId: paragraph.id, node: slice.node, ...part, done: false };
        paragraph.units.push(unit); stage.units.push(unit); this.units.set(unit.id, unit);
        paragraph.preview += part.text;
      }
    }
    this.start([...this.paragraphs.values()]);
  }

  retry(groupId?: string): void {
    if (this.running) throw new Error('请等待当前翻译结束后重试。');
    const paragraphs = [...this.paragraphs.values()].filter((p) => p.state === 'failed' && (!groupId || p.id === groupId));
    if (!paragraphs.length) throw new Error('没有需要重试的段落。');
    for (const p of paragraphs) {
      for (const unit of p.units) {
        const cached = this.cache.get(unit.node);
        if (!unit.node.isConnected || !cached || unit.node.data !== cached.lastWritten) throw new Error('页面已更新，请还原原文后重新翻译。');
        unit.done = false; unit.translated = undefined;
      }
      p.state = 'pending'; p.error = undefined;
    }
    this.start(paragraphs);
  }

  private start(paragraphs: Paragraph[]): void {
    this.running = true; this.message = '正在翻译';
    const epoch = ++this.epoch;
    this.markers(); this.changed();
    try {
      this.cancel = this.transport(paragraphs.flatMap((p) => p.units.map(({ id, groupId, text }) => ({ id, groupId, text }))), (event) => {
        if (epoch !== this.epoch) return; // Ignore packets arriving after restore.
        this.receive(event);
      });
    } catch (error) {
      this.receive({ type: 'fatal', error: error instanceof Error ? error.message : '无法连接翻译后台。' });
    }
  }

  private receive(event: StreamEvent): void {
    if (event.type === 'pong') return;
    if (event.type === 'delta' || event.type === 'complete') {
      const unit = this.units.get(event.id);
      if (!unit) return;
      const p = this.paragraphs.get(unit.groupId)!;
      if (p.state !== 'pending') return;
      if (event.type === 'delta') { unit.translated = event.text; this.render(unit.node); return; }
      else { unit.done = true; if (p.units.every((u) => u.done)) p.state = 'completed'; }
    } else if (event.type === 'reset') {
      for (const id of event.ids) {
        const u = this.units.get(id);
        if (u && this.paragraphs.get(u.groupId)?.state === 'pending') { u.translated = undefined; u.done = false; this.render(u.node); }
      }
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

  private fail(paragraph: Paragraph, error: string): void {
    paragraph.state = 'failed'; paragraph.error = error;
    const nodes = new Set<Text>();
    for (const unit of paragraph.units) { unit.translated = undefined; unit.done = false; nodes.add(unit.node); }
    nodes.forEach((node) => this.render(node));
  }

  private render(node: Text): void {
    const stage = this.stages.get(node);
    const cached = this.cache.get(node);
    if (!stage || !cached) return;
    if (!node.isConnected || node.data !== cached.lastWritten) {
      // A page framework owns the new text. Drop the old restoration snapshot.
      this.cache.delete(node);
      for (const groupId of new Set(stage.units.map((unit) => unit.groupId))) this.fail(this.paragraphs.get(groupId)!, '页面在翻译期间更新了内容，请重新翻译。');
      this.markers(); this.changed();
      return;
    }
    let text = ''; let cursor = 0;
    for (const unit of [...stage.units].sort((a, b) => a.start - b.start)) {
      text += stage.base.slice(cursor, unit.start) + (unit.translated ?? stage.base.slice(unit.start, unit.end));
      cursor = unit.end;
    }
    text += stage.base.slice(cursor);
    node.data = text; cached.lastWritten = text;
  }

  private clearMarkers(): void {
    for (const p of this.paragraphs.values()) {
      if (p.element.classList.contains(PENDING_CLASS) || p.element.classList.contains(FAILED_CLASS)) p.element.classList.remove(PENDING_CLASS, FAILED_CLASS);
      if (!p.hadClass && p.element.getAttribute('class') === '') p.element.removeAttribute('class');
    }
  }

  private markers(): void {
    this.clearMarkers();
    // Several independently selected fragments can share a block element.
    for (const p of this.paragraphs.values()) {
      if (p.state === 'pending' && this.running) p.element.classList.add(PENDING_CLASS);
      if (p.state === 'failed') p.element.classList.add(FAILED_CLASS);
    }
  }

  restore(notify = true): number {
    this.epoch++; this.cancel?.(); this.cancel = undefined; this.running = false;
    let restored = 0;
    for (const [node, cached] of this.cache) if (node.isConnected && node.data === cached.lastWritten) { node.data = cached.original; restored++; }
    this.clearMarkers(); this.cache.clear(); this.stages.clear(); this.units.clear(); this.paragraphs.clear();
    this.message = `已还原原文（${restored} 个文本节点）`;
    if (notify) this.changed();
    return restored;
  }
}

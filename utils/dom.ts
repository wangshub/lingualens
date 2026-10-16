/** In-place translation changes Text.data only. Bilingual output uses a separate
 * owned companion. Never replace or normalize the source elements/text nodes:
 * existing links, listeners and node identities must survive every view change.
 */
export const EXCLUDED = 'script,style,noscript,code,pre,kbd,samp,textarea,input,select,option,button,svg,math,canvas,iframe,object,embed,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[aria-hidden="true"],[data-lingualens-ui]';
export const PENDING_CLASS = 'lingualens-node-pending';
export const FAILED_CLASS = 'lingualens-node-failed';

export interface TextSlice { node: Text; start: number; end: number; block: Element }

export function collectText(root: Node = document.body, ranges?: Range[]): TextSlice[] {
  const slices: TextSlice[] = [];
  const visibility = new WeakMap<Element, boolean>();
  const visible = (element: Element): boolean => {
    const cached = visibility.get(element);
    if (cached !== undefined) return cached;
    const style = getComputedStyle(element);
    const result = !element.hasAttribute('hidden') && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0' && (!element.parentElement || visible(element.parentElement));
    visibility.set(element, result);
    return result;
  };
  const visit = (node: Text) => {
    const parent = node.parentElement;
    if (!parent || !node.data.trim() || !/\p{L}/u.test(node.data) || /^\s*https?:\/\/\S+\s*$/.test(node.data) || parent.closest(EXCLUDED) || !visible(parent)) return;
    const rectRange = document.createRange();
    rectRange.selectNodeContents(node);
    // Rendered content below the viewport is included; display:none and closed
    // details are excluded. This does not limit translation to the viewport.
    if (!rectRange.getClientRects().length) return;
    // Prefer semantic paragraphs over a styled inline descendant.
    let block = parent.closest('p,h1,h2,h3,h4,h5,h6,li,dt,dd,td,th,figcaption,blockquote') ?? parent;
    while (block.parentElement && !/^(block|flow-root|list-item|table-cell|flex|grid)$/.test(getComputedStyle(block).display)) block = block.parentElement;
    const add = (start: number, end: number) => {
      const value = node.data.slice(start, end);
      const leading = value.length - value.trimStart().length;
      const trailing = value.length - value.trimEnd().length;
      if (start + leading < end - trailing && /\p{L}/u.test(value)) slices.push({ node, block, start: start + leading, end: end - trailing });
    };
    if (!ranges) { add(0, node.length); return; }
    for (const range of ranges) {
      if (!range.intersectsNode(node)) continue;
      if (range.comparePoint(node, 0) === 1 || range.comparePoint(node, node.length) === -1) continue;
      add(range.startContainer === node ? range.startOffset : 0, range.endContainer === node ? range.endOffset : node.length);
    }
  };
  if (root.nodeType === Node.TEXT_NODE) visit(root as Text);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) visit(walker.currentNode as Text);
  }
  if (slices.length > 12000) throw new Error('页面超过 12000 个文本节点，请选中局部翻译。');
  return slices;
}

/** Split by encoded payload size at Unicode code point boundaries. The small
 * segment size leaves room for JSON ids even with the minimum batch budget.
 */
export function splitSlice(slice: TextSlice, maxBytes = 800): { start: number; end: number; text: string }[] {
  const parts: { start: number; end: number; text: string }[] = [];
  let start = slice.start;
  const encoder = new TextEncoder();
  while (start < slice.end) {
    let offset = start; let bytes = 0;
    for (const char of slice.node.data.slice(start, slice.end)) {
      const size = encoder.encode(JSON.stringify(char).slice(1, -1)).length;
      if (bytes + size > maxBytes && offset > start) break;
      bytes += size; offset += char.length;
    }
    let end = offset;
    if (end < slice.end) {
      const candidate = [...slice.node.data.slice(start, end).matchAll(/[。！？.!?;,，；：:\s]+/gu)].at(-1);
      if (candidate && candidate.index >= (end - start) / 2) end = start + candidate.index + candidate[0].length;
    }
    const raw = slice.node.data.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    // Keep boundary spaces in the base DOM text, outside the translated range.
    if (leading + trailing < raw.length) parts.push({ start: start + leading, end: end - trailing, text: raw.trim() });
    start = end;
  }
  return parts;
}

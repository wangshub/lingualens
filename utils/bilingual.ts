import { EXCLUDED } from './dom';

/** Detect replaced, moved or inserted source nodes without counting extension UI. */
export function sourceStructure(root: Element): { node: Text; parent: Node | null; source: string }[] {
  const result: { node: Text; parent: Node | null; source: string }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest(EXCLUDED)) result.push({ node, parent: node.parentNode, source: node.data });
  }
  return result;
}

interface TranslationRow { host: HTMLSpanElement; text: Map<Text, Text> }
const INLINE = new Set(['A', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SMALL', 'MARK', 'SUB', 'SUP', 'BR', 'ABBR', 'BDI', 'BDO', 'Q', 'CITE', 'TIME', 'DEL', 'INS', 'WBR', 'CODE', 'KBD', 'SAMP']);
const OMIT = 'script,style,noscript,input,textarea,select,button,svg,math,canvas,iframe,object,embed,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-lingualens-ui]';

/** A block-level span is legal inside p/li/td and participates in their flow.
 * Its ShadowRoot isolates styling and avoids copying IDs, event handlers or
 * executable HTML. Source elements are never cloned/replaced/reparented.
 */
export class BilingualRenderer {
  private rows = new Map<Element, TranslationRow>();

  update(element: Element, id: string, owned: Set<Text>, value: (node: Text) => string): void {
    let row = this.rows.get(element);
    if (!row?.host.isConnected) {
      row?.host.remove();
      const host = document.createElement('span');
      host.dataset.lingualensUi = 'translation';
      host.dataset.lingualensTranslation = id;
      host.style.cssText = 'all:initial!important;display:block!important;font:inherit!important;color:inherit!important;margin:.55em 0 .15em!important;white-space:normal!important;';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = 'section{font:inherit;font-weight:400;line-height:1.65;border-inline-start:2px solid #93c5fd;padding-inline-start:.75em;overflow-wrap:anywhere;white-space:pre-wrap}a{color:#2563eb;text-decoration:underline}strong,b{font-weight:700}code,kbd,samp{font-family:monospace;font-size:.92em}';
      const section = document.createElement('section');
      section.setAttribute('aria-label', '段落译文'); section.dir = 'auto';
      const text = new Map<Text, Text>();
      const clone = (source: Node): Node | null => {
        if (source.nodeType === Node.TEXT_NODE) {
          const copy = document.createTextNode(value(source as Text)); text.set(source as Text, copy); return copy;
        }
        if (!(source instanceof HTMLElement) || source.matches(OMIT)) return null;
        // A layout container may also own nested, independently translated
        // paragraphs. Include only this paragraph's own inline content.
        const containsOwned = [...owned].some((node) => source.contains(node));
        if (!INLINE.has(source.tagName) && !containsOwned) return null;
        const copy = document.createElement(INLINE.has(source.tagName) ? source.tagName.toLowerCase() : 'span');
        for (const attribute of ['title', 'lang', 'dir']) if (source.hasAttribute(attribute)) copy.setAttribute(attribute, source.getAttribute(attribute)!);
        if (source.tagName === 'A' && source.hasAttribute('href')) {
          const href = source.getAttribute('href')!;
          try {
            const url = new URL(href, document.baseURI);
            if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
              copy.setAttribute('href', url.href); copy.setAttribute('target', '_blank'); copy.setAttribute('rel', 'noopener noreferrer');
            }
          } catch { /* Invalid source links remain readable text. */ }
        }
        for (const child of source.childNodes) { const next = clone(child); if (next) copy.appendChild(next); }
        return copy;
      };
      for (const source of element.childNodes) { const copy = clone(source); if (copy) section.append(copy); }
      shadow.append(style, section);
      // Put the translation before nested lists/paragraphs when the source is
      // a list item, table cell or a layout container with direct text.
      let anchor: Node | undefined;
      for (const node of owned) {
        let child: Node = node;
        while (child.parentNode && child.parentNode !== element) child = child.parentNode;
        if (child.parentNode === element) anchor = child;
      }
      // Punctuation-only text nodes are not translation units, but still belong
      // above the bilingual row. Stop before an independent nested block.
      while (anchor?.nextSibling) {
        const next = anchor.nextSibling;
        if (next instanceof HTMLElement && !INLINE.has(next.tagName) && /^(block|flow-root|list-item|table|flex|grid)$/.test(getComputedStyle(next).display)) break;
        anchor = next;
      }
      if (anchor) element.insertBefore(host, anchor.nextSibling); else element.append(host);
      row = { host, text }; this.rows.set(element, row);
    }
    for (const [source, copy] of row.text) copy.data = value(source);
  }

  remove(element: Element): void { this.rows.get(element)?.host.remove(); this.rows.delete(element); }
  clear(): void { for (const element of this.rows.keys()) this.remove(element); }
}

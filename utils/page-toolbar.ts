import type { TranslationController } from './translation-controller';
import type { ViewMode } from '../types';

/** The status UI lives in a ShadowRoot so host-page CSS cannot affect controls. */
export function createPageToolbar(controller: TranslationController, changeView: (mode: ViewMode) => void | Promise<void> = (mode) => controller.show(mode)) {
  const host = document.createElement('div');
  host.dataset.lingualensUi = 'true';
  host.style.cssText = 'all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;display:none;color-scheme:light;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `*{box-sizing:border-box}section{font:14px/1.6 system-ui,sans-serif;color:#182230;width:340px;max-width:calc(100vw - 40px);background:#fff;border:1px solid #dbe2eb;border-radius:14px;box-shadow:0 8px 36px #18223024;padding:16px}header{display:flex;align-items:center;justify-content:space-between;font-weight:650}p{margin:9px 0;overflow-wrap:anywhere}button{font:inherit;border:1px solid #dbe2eb;background:#fff;padding:5px 10px;border-radius:7px;cursor:pointer;color:#243247}button:hover{background:#edf4ff}button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}button:disabled{opacity:.5;cursor:wait}.actions{display:flex;gap:8px}.progress{height:4px;background:#e6edf8;border-radius:8px;margin:12px 0;overflow:hidden}.bar{height:100%;background:#2563eb;transition:width .2s}.failure{padding-top:10px;margin-top:10px;border-top:1px solid #e3e8ef}.failure p{font-size:13px}.errors{max-height:220px;overflow:auto}small{color:#53647a}button.close{border:0;padding:0 5px;font-size:20px;line-height:1.3}@media(prefers-reduced-motion:reduce){.bar{transition:none}}`;
  shadow.append(style);
  const modeStyle = document.createElement('style');
  modeStyle.textContent = '.modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:12px 0}.mode[aria-pressed="true"]{color:#1d4ed8;background:#eff6ff;border-color:#bfdbfe}.mode{transition:background-color .15s}@media(prefers-reduced-motion:reduce){.mode{transition:none}}';
  shadow.append(modeStyle);
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'LinguaLens 翻译状态');
  const header = document.createElement('header');
  const title = document.createElement('span'); title.textContent = 'LinguaLens';
  const close = document.createElement('button'); close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', '隐藏翻译状态'); close.onclick = () => { host.style.display = 'none'; };
  header.append(title, close);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const progress = document.createElement('div'); progress.className = 'progress';
  const bar = document.createElement('div'); bar.className = 'bar'; progress.append(bar);
  const actions = document.createElement('div'); actions.className = 'actions';
  const retry = document.createElement('button'); retry.textContent = '重试失败段落';
  const showError = (error: unknown) => { status.textContent = error instanceof Error ? error.message : '操作失败。'; };
  const modes = document.createElement('div'); modes.className = 'modes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '显示方式');
  const buttons = new Map<ViewMode, HTMLButtonElement>();
  for (const [mode, label] of [['original', '原文'], ['translated', '译文'], ['bilingual', '双语对照']] as const) {
    const button = document.createElement('button'); button.className = 'mode'; button.textContent = label;
    if (mode === 'original') button.setAttribute('aria-label', '还原原文');
    button.onclick = () => { void Promise.resolve().then(() => changeView(mode)).catch(showError); };
    buttons.set(mode, button); modes.append(button);
  }
  retry.onclick = () => { try { controller.retry(); } catch (e) { showError(e); } };
  actions.append(retry);
  const errors = document.createElement('div'); errors.className = 'errors';
  section.append(header, status, progress, modes, actions, errors); shadow.append(section);
  let previousErrors = '';
  const mount = () => { if (!host.isConnected) document.documentElement.append(host); };
  return {
    update() {
      mount(); host.style.display = 'block';
      const state = controller.status;
      for (const [mode, button] of buttons) button.setAttribute('aria-pressed', String(state.viewMode === mode));
      status.textContent = state.total
        ? !state.busy && state.failed ? `${state.completed} 段成功，${state.failed} 段失败` : `${state.message} · ${state.completed}/${state.total} 段`
        : state.message ?? '';
      status.style.color = !state.busy && state.failed ? '#92400e' : '#182230';
      progress.hidden = !state.busy;
      bar.style.width = `${state.total ? (state.completed + state.failed) / state.total * 100 : 0}%`;
      retry.hidden = state.failed <= 1; retry.disabled = state.busy;
      // Keep retry buttons stable while tokens stream, preserving keyboard focus.
      const failures = [...controller.paragraphs.values()].filter((p) => p.state === 'failed');
      const key = JSON.stringify(failures.map((p) => [p.id, p.error, state.busy]));
      if (key !== previousErrors) {
        previousErrors = key; errors.replaceChildren();
        for (const p of failures) {
          const row = document.createElement('div'); row.className = 'failure';
          const preview = document.createElement('small'); preview.textContent = p.preview.slice(0, 72);
          const reason = document.createElement('p'); reason.textContent = p.error ?? '翻译失败';
          const button = document.createElement('button'); button.textContent = '重试这一段'; button.disabled = state.busy;
          button.onclick = () => { try { controller.retry(p.id); } catch (e) { showError(e); } };
          row.append(preview, reason, button); errors.append(row);
        }
      }
    },
    notice(message: string) { mount(); host.style.display = 'block'; status.textContent = message; },
    remove() { host.remove(); },
  };
}

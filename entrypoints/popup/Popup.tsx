import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Languages, LoaderCircle, RotateCcw, Settings2 } from 'lucide-react';
import type { PageCommand, PageStatus, Settings } from '../../types';
import { Brand } from '../../components/Brand';
import { Feedback, type FeedbackValue } from '../../components/Feedback';
import { useSettings } from '../../components/useSettings';
import { activeProfile, saveSettings } from '../../utils/settings';
import { LANGUAGES } from '../../utils/defaults';
import { pageAction } from '../../utils/messaging';
import { errorMessage } from '../../utils/api';

export function Popup() {
  const { settings, setSettings, error } = useSettings();
  const [status, setStatus] = useState<PageStatus>();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackValue>();
  const refresh = useCallback(async () => {
    try { setStatus(await pageAction({ type: 'status' })); }
    catch (e) { setFeedback({ kind: 'error', text: errorMessage(e) }); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 1500); return () => clearInterval(timer); }, [refresh]);
  if (!settings) return <main className="w-[380px] p-6"><Brand compact /><p className="mt-5" role="status">{error || '正在读取配置…'}</p></main>;
  const profile = activeProfile(settings);
  const persist = async (value: Settings) => {
    setFeedback(undefined);
    try { await saveSettings(value); setSettings(value); }
    catch (e) { setFeedback({ kind: 'error', text: errorMessage(e) }); }
  };
  const action = async (command: PageCommand) => {
    setPending(true); setFeedback(undefined);
    try { const result = await pageAction(command); setStatus(result); if (command.type === 'restore') setFeedback({ kind: 'success', text: result.message ?? '已还原原文。' }); }
    catch (e) { setFeedback({ kind: 'error', text: errorMessage(e) }); }
    finally { setPending(false); }
  };
  const busy = pending || status?.busy;
  const languages = LANGUAGES.includes(profile.targetLanguage) ? LANGUAGES : [profile.targetLanguage, ...LANGUAGES];

  return <main className="entrance w-[380px] bg-white p-5">
    <header className="mb-7 flex items-center justify-between"><Brand compact /><button className="icon-btn" title="打开设置" aria-label="打开设置" onClick={() => { void chrome.runtime.openOptionsPage(); }}><Settings2 size={19} /></button></header>
    <div className="mb-5"><label htmlFor="profile" className="field-label flex items-center justify-between">当前模型<span className="text-xs font-normal tracking-wide text-slate-400">BYOK</span></label><select id="profile" className="field" value={profile.id} disabled={busy} onChange={(e) => { void persist({ ...settings, activeProfileId: e.target.value }); }}>{settings.profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></div>
    <div className="mb-6"><label className="field-label" htmlFor="language">翻译为</label><div className="flex items-center gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Languages size={20} /></div><select className="field" id="language" value={profile.targetLanguage} disabled={busy} onChange={(e) => { void persist({ ...settings, profiles: settings.profiles.map((p) => p.id === profile.id ? { ...p, targetLanguage: e.target.value } : p) }); }}>{languages.map((l) => <option key={l}>{l}</option>)}</select></div></div>
    <button className="btn btn-primary w-full py-3" disabled={busy} onClick={() => { void action({ type: 'page' }); }}>{busy ? <><LoaderCircle size={18} className="animate-spin" />正在翻译…</> : <>翻译当前页面<ArrowRight size={17} /></>}</button>
    <button className="btn mt-2.5 w-full" disabled={pending} onClick={() => { void action({ type: 'restore' }); }}><RotateCcw size={16} />还原原文{status?.busy ? '并停止' : ''}</button>
    {(status?.total ?? 0) > 0 && <div className="mt-4"><div className="mb-2 flex justify-between text-sm text-slate-500"><span>{status?.message}</span><span>{status?.completed}/{status?.total} 段</span></div><div className="h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-blue-600 transition-[width]" style={{ width: `${((status?.completed ?? 0) + (status?.failed ?? 0)) / (status?.total ?? 1) * 100}%` }} /></div>{!!status?.failed && <button className="mt-3 text-sm text-amber-700 underline underline-offset-4" disabled={busy} onClick={() => { void action({ type: 'retry' }); }}>重试 {status.failed} 个失败段落</button>}</div>}
    {feedback && <div className="mt-4"><Feedback value={feedback} /></div>}
    <footer className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">选中文本后右键，直接翻译选区。</footer>
  </main>;
}

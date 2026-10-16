import { useState } from 'react';
import { ArrowUpRight, Check, Eye, EyeOff, FlaskConical, LoaderCircle, Plus, RotateCcw, Save, Star, Trash2 } from 'lucide-react';
import type { ModelProfile, Settings } from '../../types';
import { Brand } from '../../components/Brand';
import { Feedback, type FeedbackValue } from '../../components/Feedback';
import { useSettings } from '../../components/useSettings';
import { DEFAULT_PROMPT, LANGUAGES, newProfile, PROVIDERS } from '../../utils/defaults';
import { saveSettings, validateProfile } from '../../utils/settings';
import { request } from '../../utils/messaging';
import { errorMessage } from '../../utils/api';

export function Options() {
  const { settings, setSettings, error } = useSettings();
  const [selectedId, setSelectedId] = useState('');
  const [visible, setVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackValue>();
  const profile = settings?.profiles.find((p) => p.id === selectedId) ?? settings?.profiles.find((p) => p.id === settings.activeProfileId);
  if (!settings || !profile) return <main className="mx-auto max-w-4xl p-10"><Brand /><p className="mt-8" role="status">{error || '正在读取配置…'}</p></main>;

  const edit = (patch: Partial<ModelProfile>) => {
    setSettings({ ...settings, profiles: settings.profiles.map((p) => p.id === profile.id ? { ...p, ...patch } : p) });
    setDirty(true); setFeedback(undefined);
  };
  const commit = async (value: Settings = settings) => {
    setSaving(true); setFeedback(undefined);
    try { await saveSettings(value); setSettings(value); setDirty(false); setFeedback({ kind: 'success', text: '配置已保存。' }); }
    catch (e) { setFeedback({ kind: 'error', text: errorMessage(e) }); }
    finally { setSaving(false); }
  };
  const test = async () => {
    setTesting(true); setFeedback(undefined);
    try { validateProfile(profile); const result = await request<{ message: string }>({ type: 'test-connection', profile }); setFeedback({ kind: 'success', text: result.message }); }
    catch (e) { setFeedback({ kind: 'error', text: errorMessage(e) }); }
    finally { setTesting(false); }
  };

  return <div className="entrance mx-auto max-w-[1120px] px-5 pb-12 pt-8 sm:px-10">
    <header className="flex flex-wrap items-center justify-between gap-5 border-b border-slate-200 pb-7">
      <Brand compact /><div className="flex items-center gap-3 text-sm"><span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">BYOK · 自带密钥</span><span className="text-slate-400">v{chrome.runtime.getManifest().version}</span></div>
    </header>
    <div className="mb-6 mt-7"><h1 className="text-[26px] font-semibold tracking-tight">模型与翻译设置</h1><p className="mt-2 text-slate-500">连接你的 AI 服务，设置目标语言与翻译要求。</p></div>
    <div className="grid items-start gap-7 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside aria-label="模型配置" className="md:sticky md:top-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-600">模型配置</h2><span className="text-sm text-slate-400">{settings.profiles.length}</span></div>
        <div className="space-y-2">{settings.profiles.map((p) => <button key={p.id} type="button" aria-pressed={p.id === profile.id} onClick={() => { setSelectedId(p.id); setVisible(false); setFeedback(undefined); }} className={`w-full rounded-lg border px-3 py-3 text-left transition ${p.id === profile.id ? 'border-blue-200 bg-blue-50' : 'border-transparent hover:bg-white'}`}>
          <span className="flex items-center justify-between gap-2 font-medium"><span className="break-all">{p.name}</span>{p.id === settings.activeProfileId && <Star size={14} className="shrink-0 fill-blue-600 text-blue-600" aria-label="默认配置" />}</span><span className="mt-0.5 block break-all text-sm text-slate-500">{p.model}</span>
        </button>)}</div>
        <button type="button" className="btn mt-3 w-full border-dashed" onClick={() => { const p = { ...newProfile(), name: '新配置' }; setSettings({ ...settings, profiles: [...settings.profiles, p] }); setSelectedId(p.id); setDirty(true); setVisible(false); setFeedback(undefined); }}><Plus size={16} />添加配置</button>
      </aside>
      <form onSubmit={(event) => { event.preventDefault(); void commit(); }} className="min-w-0 space-y-5">
        <section className="panel p-5 sm:p-7" aria-labelledby="connection-title">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h2 id="connection-title" className="text-lg font-semibold">模型连接</h2><p className="mt-1 text-sm text-slate-500">支持兼容 OpenAI 格式的服务与本地模型。</p></div>{profile.id === settings.activeProfileId ? <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-sm text-blue-700"><Check size={14} />默认配置</span> : <button type="button" className="btn py-1.5" disabled={saving} onClick={() => { void commit({ ...settings, activeProfileId: profile.id }); }}>设为默认</button>}</div>
          <div className="mb-6 flex flex-wrap gap-2" aria-label="服务预设">{PROVIDERS.map((p) => <button type="button" key={p.name} className="rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-500 transition hover:border-blue-300 hover:text-blue-600" onClick={() => edit({ name: p.name, baseUrl: p.baseUrl, model: p.model })}>{p.name}<ArrowUpRight size={12} className="ml-1 inline" /></button>)}</div>
          <div className="space-y-5">
            <div><label className="field-label" htmlFor="name">配置名称</label><input className="field" id="name" required maxLength={80} value={profile.name} onChange={(e) => edit({ name: e.target.value })} /></div>
            <div><label className="field-label" htmlFor="baseUrl">API Base URL</label><input className="field font-mono" id="baseUrl" type="url" required placeholder="https://api.example.com/v1" value={profile.baseUrl} onChange={(e) => edit({ baseUrl: e.target.value })} /><p className="helper">填写包含版本路径的地址，例如 /v1；也可填写完整 /chat/completions 地址。</p></div>
            <div><label className="field-label" htmlFor="apiKey">API Key</label><div className="relative"><input className="field pr-12 font-mono" id="apiKey" type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="输入服务商提供的密钥" value={profile.apiKey} onChange={(e) => edit({ apiKey: e.target.value })} /><button type="button" className="icon-btn absolute right-1 top-1" aria-label={visible ? '隐藏 API Key' : '显示 API Key'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><p className="helper">密钥保存在当前浏览器。Ollama 等免鉴权服务可留空。</p></div>
            <div><label className="field-label" htmlFor="model">模型名称</label><input className="field font-mono" id="model" required value={profile.model} onChange={(e) => edit({ model: e.target.value })} /><p className="helper">请使用该 API Key 实际可访问的模型 ID。</p></div>
          </div>
        </section>
        <section className="panel p-5 sm:p-7" aria-labelledby="translation-title">
          <h2 id="translation-title" className="mb-5 text-lg font-semibold">翻译方式</h2>
          <div className="mb-5"><label className="field-label" htmlFor="language">目标语言</label><input className="field" id="language" required list="languages" value={profile.targetLanguage} onChange={(e) => edit({ targetLanguage: e.target.value })} /><datalist id="languages">{LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist></div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2"><label className="text-sm font-medium" htmlFor="prompt">系统 Prompt</label><button type="button" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600" onClick={() => edit({ systemPrompt: DEFAULT_PROMPT })}><RotateCcw size={13} />恢复默认</button></div>
          <textarea id="prompt" className="field min-h-48 resize-y leading-7" required maxLength={12000} value={profile.systemPrompt} onChange={(e) => edit({ systemPrompt: e.target.value })} />
          <p className="helper">使用 {'{目标语言}'} 或 {'{targetLanguage}'} 自动填入目标语言。建议保留忠实、不增译、不漏译的约束。</p>
          <details className="mt-6 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">请求与并发设置</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="concurrency">最大并发请求</label><input id="concurrency" className="field" type="number" min={1} max={4} value={settings.concurrency} onChange={(e) => { setSettings({ ...settings, concurrency: Number(e.target.value) }); setDirty(true); }} /></div><div><label className="field-label" htmlFor="budget">每批文本预算（UTF-8 字节）</label><input id="budget" className="field" type="number" min={1200} max={12000} step={100} value={settings.batchBytes} onChange={(e) => { setSettings({ ...settings, batchBytes: Number(e.target.value) }); setDirty(true); }} /></div></div><p className="helper">限流时降低并发。预算控制输入文本大小，系统指令和输出另占上下文。</p></details>
        </section>
        <Feedback value={feedback} />
        <div className="flex flex-wrap items-center justify-between gap-4"><button className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-600 disabled:opacity-40" type="button" disabled={settings.profiles.length === 1} onClick={() => { const remaining = settings.profiles.filter((p) => p.id !== profile.id); setSettings({ ...settings, profiles: remaining, activeProfileId: settings.activeProfileId === profile.id ? remaining[0]!.id : settings.activeProfileId }); setSelectedId(remaining[0]!.id); setDirty(true); setFeedback(undefined); }}><Trash2 size={15} />删除此配置</button><div className="flex flex-wrap items-center gap-3"><span className="text-sm text-slate-400" role="status">{dirty ? '有未保存的修改' : ''}</span><button className="btn" type="button" disabled={testing || saving} onClick={() => { void test(); }}>{testing ? <LoaderCircle size={16} className="animate-spin" /> : <FlaskConical size={16} />}{testing ? '测试中…' : '测试连接'}</button><button className="btn btn-primary" type="submit" disabled={saving || testing}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}{saving ? '保存中…' : '保存配置'}</button></div></div>
      </form>
    </div>
    <footer className="mt-10 border-t border-slate-200 pt-5 text-sm text-slate-400">LinguaLens · MIT 开源许可 · 翻译内容仅发送给你配置的服务</footer>
  </div>;
}

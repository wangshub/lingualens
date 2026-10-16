export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3">
    <svg viewBox="0 0 40 40" className={compact ? 'size-9' : 'size-11'} aria-hidden="true">
      <rect width="40" height="40" rx="12" fill="#2563eb" />
      <path d="M11 10v17h13M25 12a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm6 14 5 6" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <div><div className="font-semibold tracking-tight text-[20px]">LinguaLens</div>{!compact && <p className="text-sm text-slate-500">让每种语言，都贴近原文。</p>}</div>
  </div>;
}

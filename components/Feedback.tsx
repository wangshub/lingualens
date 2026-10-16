import { AlertCircle, CheckCircle2 } from 'lucide-react';

export interface FeedbackValue { kind: 'error' | 'success'; text: string }

export function Feedback({ value }: { value?: FeedbackValue }) {
  if (!value) return null;
  const Icon = value.kind === 'error' ? AlertCircle : CheckCircle2;
  return <div role={value.kind === 'error' ? 'alert' : 'status'} className={`feedback ${value.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{value.text}</span>
  </div>;
}

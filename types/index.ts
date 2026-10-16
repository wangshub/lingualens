/** Secrets stay in trusted extension contexts; this type never goes to the page. */
export interface ModelProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  targetLanguage: string;
  systemPrompt: string;
}

export interface Settings {
  schemaVersion: 1;
  profiles: ModelProfile[];
  activeProfileId: string;
  concurrency: number;
  batchBytes: number;
}

export interface PublicSettings {
  profileName: string;
  model: string;
  targetLanguage: string;
  cacheKey: string;
}

export type ViewMode = 'original' | 'translated' | 'bilingual';
export type TranslationMode = Exclude<ViewMode, 'original'>;

/** Each source segment belongs to a paragraph, but never contains HTML. */
export interface Segment {
  id: string;
  groupId: string;
  text: string;
}

export type StreamRequest =
  | { type: 'translate'; segments: Segment[]; cacheKey?: string }
  | { type: 'ping' }
  | { type: 'cancel' };

export type StreamEvent =
  | { type: 'delta'; id: string; text: string }
  | { type: 'complete'; id: string }
  | { type: 'reset'; ids: string[] }
  | { type: 'failed'; ids: string[]; error: string }
  | { type: 'fatal'; error: string }
  | { type: 'finished' }
  | { type: 'pong' };

export type PageCommand =
  | { type: 'page'; mode?: TranslationMode; force?: boolean }
  | { type: 'selection'; selectionText: string }
  | { type: 'restore' }
  | { type: 'view'; mode: ViewMode }
  | { type: 'retry'; groupId?: string }
  | { type: 'status' }
  | { type: 'ping' }
  | { type: 'notice'; error: string };

export interface PageStatus {
  busy: boolean;
  total: number;
  completed: number;
  failed: number;
  viewMode: ViewMode;
  cached: number;
  restored?: number;
  message?: string;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

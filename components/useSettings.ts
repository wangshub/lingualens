import { useEffect, useState } from 'react';
import type { Settings } from '../types';
import { loadSettings, SETTINGS_KEY } from '../utils/settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    void loadSettings().then((value) => { if (mounted) setSettings(value); }).catch(() => { if (mounted) setError('无法读取设置，请重新加载插件。'); });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[SETTINGS_KEY]?.newValue) setSettings(changes[SETTINGS_KEY].newValue as Settings);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => { mounted = false; chrome.storage.onChanged.removeListener(listener); };
  }, []);
  return { settings, setSettings, error };
}

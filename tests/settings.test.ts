import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { newProfile } from '../utils/defaults';
import { translationContext } from '../utils/settings';

afterEach(() => vi.unstubAllGlobals());

it('keys results by translation inputs, while keeping credentials out of the context', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const profile = newProfile();
  const original = await translationContext(profile);
  expect(original).toMatch(/^[a-f0-9]{64}$/);
  expect(await translationContext({ ...profile, apiKey: 'a-different-test-key', name: 'Renamed profile' })).toBe(original);
  for (const patch of [{ id: 'another-profile' }, { baseUrl: 'https://example.com/v1' }, { model: 'another-model' }, { targetLanguage: 'English' }, { systemPrompt: 'Different translation instructions' }]) {
    expect(await translationContext({ ...profile, ...patch })).not.toBe(original);
  }
});

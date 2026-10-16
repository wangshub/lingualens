import { expect, it } from 'vitest';
import { Semaphore } from '../utils/scheduler';

it('limits work across sessions and aborts queued tasks', async () => {
  const slots = new Semaphore(1);
  let release: () => void = () => undefined;
  const first = slots.use(new AbortController().signal, () => new Promise<void>((resolve) => { release = resolve; }));
  const cancel = new AbortController();
  let called = false;
  const second = slots.use(cancel.signal, async () => { called = true; });
  cancel.abort(); await expect(second).rejects.toThrow('已取消');
  release(); await first; expect(called).toBe(false);
  await expect(slots.use(new AbortController().signal, async () => 'ready')).resolves.toBe('ready');
});

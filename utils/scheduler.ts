/** A worker-wide semaphore prevents several tabs from multiplying API concurrency. */
export class Semaphore {
  private active = 0;
  private waiters = new Set<() => void>();
  constructor(private readonly limit: number) {}

  async use<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    while (this.active >= this.limit) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      await new Promise<void>((resolve, reject) => {
        const resume = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(new DOMException('已取消', 'AbortError')); };
        const cleanup = () => { this.waiters.delete(resume); signal.removeEventListener('abort', abort); };
        this.waiters.add(resume);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    this.active++;
    try { return await work(); }
    finally { this.active--; for (const resume of [...this.waiters]) resume(); }
  }
}

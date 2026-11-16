export function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(!signal?.aborted);
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class HumanDelaysEngine {
  private messageCount = 0;
  private targetInterval = this.rollInterval();

  private rollInterval(): number {
    return Math.floor(Math.random() * (12 - 10 + 1)) + 10;
  }

  async waitCustomDelay(
    minSec = 10,
    maxSec = 30,
    signal?: AbortSignal,
    onPlannedDelay?: (delayMs: number) => void
  ): Promise<{ delayMs: number; completed: boolean }> {
    const min = Math.max(1, minSec);
    const max = Math.max(min, maxSec);
    const delaySec = Math.floor(Math.random() * (max - min + 1)) + min;
    const delayMs = delaySec * 1000;
    onPlannedDelay?.(delayMs);
    const completed = await interruptibleSleep(delayMs, signal);
    return { delayMs, completed };
  }

  async waitAttachmentPause(
    signal?: AbortSignal,
    onPlannedDelay?: (delayMs: number) => void
  ): Promise<{ delayMs: number; completed: boolean }> {
    const delayMs = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
    onPlannedDelay?.(delayMs);
    const completed = await interruptibleSleep(delayMs, signal);
    return { delayMs, completed };
  }

  async checkReviewPause(
    signal?: AbortSignal,
    onPlannedDelay?: (delayMs: number) => void
  ): Promise<{ delayMs: number; completed: boolean }> {
    this.messageCount++;

    if (this.messageCount >= this.targetInterval) {
      this.messageCount = 0;
      this.targetInterval = this.rollInterval();
      const pauseSec = Math.floor(Math.random() * (45 - 30 + 1)) + 30;
      const pauseMs = pauseSec * 1000;
      onPlannedDelay?.(pauseMs);
      const completed = await interruptibleSleep(pauseMs, signal);
      return { delayMs: pauseMs, completed };
    }

    return { delayMs: 0, completed: true };
  }

  reset() {
    this.messageCount = 0;
    this.targetInterval = this.rollInterval();
  }
}

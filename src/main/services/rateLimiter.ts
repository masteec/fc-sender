import { interruptibleSleep } from './delaysEngine';

export class SlidingRateLimiter {
  private timestamps: number[] = [];
  private maxPerMinute: number;

  constructor(maxPerMinute = 3) {
    this.maxPerMinute = Math.max(1, maxPerMinute);
  }

  public setMaxPerMinute(maxPerMinute: number) {
    this.maxPerMinute = Math.max(1, Math.min(60, maxPerMinute));
  }

  async waitForSlot(signal?: AbortSignal, onWait?: (waitMs: number) => void): Promise<boolean> {
    let notified = false;
    while (true) {
      if (signal?.aborted) return false;

      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 60000);

      if (this.timestamps.length < this.maxPerMinute) {
        this.timestamps.push(now);
        return true;
      }

      const oldest = this.timestamps[0];
      const remainingWindowMs = Math.max(500, 60000 - (now - oldest));
      if (!notified) {
        onWait?.(remainingWindowMs);
        notified = true;
      }

      const stepMs = Math.min(1500, remainingWindowMs);
      const ok = await interruptibleSleep(stepMs, signal);
      if (!ok) return false;
    }
  }
}

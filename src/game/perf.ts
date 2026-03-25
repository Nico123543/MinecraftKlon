export interface PerfSnapshot {
  fps: number;
  onePercentLowFps: number;
  p95FrameMs: number;
}

export class PerfTracker {
  private readonly samples: number[] = [];
  private readonly maxSamples = 300;

  pushFrame(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) {
      return;
    }
    this.samples.push(frameMs);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  snapshot(): PerfSnapshot {
    if (this.samples.length === 0) {
      return { fps: 0, onePercentLowFps: 0, p95FrameMs: 0 };
    }

    const avgFrameMs = this.samples.reduce((sum, ms) => sum + ms, 0) / this.samples.length;
    const fps = 1000 / avgFrameMs;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    const p95FrameMs = sorted[p95Index];

    const worstCount = Math.max(1, Math.floor(this.samples.length * 0.01));
    const worstFrames = sorted.slice(sorted.length - worstCount);
    const worstAvg = worstFrames.reduce((sum, ms) => sum + ms, 0) / worstFrames.length;
    const onePercentLowFps = 1000 / worstAvg;

    return {
      fps,
      onePercentLowFps,
      p95FrameMs
    };
  }
}

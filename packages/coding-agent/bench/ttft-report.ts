/** Pure types + comparator for the hermetic TTFT benchmark. No IO — unit-testable. */
export interface StageBreakdown {
  manager_provision: number;
  worker_boot: number;
  /** createAgentSession seam (model-registry load, discovery, extension/plugin loading). */
  session_build: number;
  chat_handler: number;
  provider_ttft: number;
}
export interface ModeResult {
  ttft_ms: number;
  stages: StageBreakdown;
  runs: number;
}
export interface BenchResult {
  cold: ModeResult;
  warm: ModeResult;
}
export interface Regression {
  metric: string;
  baseline: number;
  current: number;
  deltaPct: number;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const STAGE_KEYS: Array<keyof StageBreakdown> = [
  "manager_provision",
  "worker_boot",
  "session_build",
  "chat_handler",
  "provider_ttft",
];
const MODES: Array<keyof BenchResult> = ["cold", "warm"];

/** Metrics slower than baseline by more than `tolerancePct` percent AND by more than
 *  `minAbsMs` absolute ms. Both guards are required so near-zero stages (provider_ttft,
 *  manager_provision ≈ 0) don't spuriously regress on sub-ms noise. Empty = within tolerance.
 *  Strict greater-than on both. */
export function compareToBaseline(
  baseline: BenchResult,
  current: BenchResult,
  tolerancePct: number,
  minAbsMs = 3,
): Regression[] {
  const regressions: Regression[] = [];
  const check = (metric: string, b: number, c: number): void => {
    const deltaPct = b === 0 ? (c > 0 ? Infinity : 0) : ((c - b) / b) * 100;
    if (c - b > minAbsMs && deltaPct > tolerancePct) {
      regressions.push({ metric, baseline: b, current: c, deltaPct });
    }
  };
  for (const mode of MODES) {
    check(`${mode}.ttft_ms`, baseline[mode].ttft_ms, current[mode].ttft_ms);
    for (const k of STAGE_KEYS) check(`${mode}.${k}`, baseline[mode].stages[k], current[mode].stages[k]);
  }
  return regressions;
}

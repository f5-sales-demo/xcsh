/**
 * Pure parsing/aggregation for TTFT A1 attribution. The worker emits
 * `[ttft-attr] <stage> <ms>` on stderr (see pi-utils ttftAttr); the bench captures
 * those lines and reduces them here. Chrome-free + I/O-free, so unit-tests in isolation.
 */
const LINE = /^\[ttft-attr\] (\S+) (\d+(?:\.\d+)?)$/;

/** First occurrence of each stage wins (later model-call iterations are post-first-token). */
export function parseAttrLines(lines: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of lines) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const stage = m[1];
    if (stage in out) continue;
    out[stage] = Number(m[2]);
  }
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function medianByStage(perRun: Record<string, number>[]): Record<string, number> {
  const stages = new Set<string>();
  for (const r of perRun) for (const k of Object.keys(r)) stages.add(k);
  const out: Record<string, number> = {};
  for (const stage of stages) {
    const vals = perRun.map(r => r[stage]).filter((v): v is number => typeof v === "number");
    if (vals.length) out[stage] = median(vals);
  }
  return out;
}

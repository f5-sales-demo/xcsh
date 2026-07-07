/**
 * Hermetic TTFT benchmark: real manager → worker → chat turn with the bench-instant
 * stand-in provider (no Chrome, no live model, no credentials). Times provision→first
 * chat_delta (cold = pool 0 / spawn, warm = pool 1 / adopt) and records the Phase-2
 * per-stage span breakdown collected off the same WS. JSON out; --check diffs a
 * committed baseline (local optimization-loop gate, NOT CI).
 *
 * WARNING: spawns a manager whose readoptWorkers probes ports 19222-19241 — only run
 * when NO other xcsh worker/manager is live on this machine, or it will adopt/reap them.
 *
 * Run:  bun packages/coding-agent/bench/ttft.ts [--check] [--update-baseline]
 *            [--out <file>] [--tolerance <pct>] [--runs <n>]
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EXTENSION_ID } from "../src/cli/chrome-cli";
import { medianByStage, parseAttrLines } from "./ttft-attr";
import { type BenchResult, compareToBaseline, median, type ModeResult, type StageBreakdown } from "./ttft-report";

const CLI = path.join(import.meta.dir, "../src/cli.ts");
const EXT = path.join(import.meta.dir, "bench-instant-extension.ts");
const BASELINE = path.join(import.meta.dir, "ttft-baseline.json");
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const CONNECT_DEADLINE_MS = 15_000;
const TURN_DEADLINE_MS = 15_000;
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

interface RunSample {
  ttft_ms: number;
  stages: StageBreakdown;
}

function spawnManager(poolSize: string): { sock: string; attrFile: string; getErr: () => string; kill: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-ttft-"));
  const sock = path.join(dir, "manager.sock");
  const attrFile = path.join(dir, "attr.log");
  const proc = Bun.spawn(["bun", CLI, "manager"], {
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      XCSH_MANAGER_SOCK: sock,
      XCSH_WORKER_POOL_SIZE: poolSize,
      XCSH_BENCH_EXTENSION: EXT,
      // TTFT A1: gate the manager (and, via ...process.env spread at the worker spawn, the
      // worker) to emit `[ttft-attr]` lines, and route them to a per-run FILE. Routing them
      // into the manager-stderr pipe (stderr:"inherit") hung the chat turn, so the worker
      // appends to XCSH_TTFT_ATTR_FILE instead — read back in runOnce. Timing-only.
      XCSH_TTFT_ATTRIBUTION: "1",
      XCSH_TTFT_ATTR_FILE: attrFile,
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  let err = "";
  void (async () => {
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        err += dec.decode(value, { stream: true });
      }
    } catch {
      /* torn down on kill */
    }
  })();
  return { sock, attrFile, getErr: () => err, kill: () => { try { proc.kill(); } catch {} } };
}

async function sendProvision(sock: string): Promise<void> {
  const c = await Bun.connect({ unix: sock, socket: { data() {} } });
  // The manager's parseControlMsg requires a piped "tenant|env" string (isTenant);
  // a bare tenant is rejected and the provision silently dropped.
  c.write(`${JSON.stringify({ type: "provision", sessionId: "tab-bench", tenant: "example-corp" })}\n`);
  await sleep(50);
  c.end();
}

async function waitForSocket(sock: string, deadlineMs: number): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (fs.existsSync(sock)) return;
    await sleep(50);
  }
  throw new Error(`manager control socket never appeared: ${sock}`);
}

async function waitForPort(getErr: () => string, re: RegExp, deadlineMs: number): Promise<number> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const m = getErr().match(re);
    if (m) return Number(m[1]);
    await sleep(100);
  }
  throw new Error(`worker port never appeared in manager stderr (looking for ${re})`);
}

const STAGE_NAMES = new Set([
  "manager_provision",
  "worker_boot",
  "session_build",
  "chat_handler",
  "provider_ttft",
]);

/** Connect as the worker's FIRST client (retry the connect until it binds — a refused
 *  attempt never opens, so it does not consume the on-connect cold-start flush), send a
 *  chat_request, and collect the first chat_delta latency (from t0) + the span stages. */
async function connectAndMeasure(port: number, t0: number, deadlineMs: number): Promise<RunSample> {
  const stages: Partial<StageBreakdown> = {};
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const sample = await new Promise<RunSample | null>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: ORIGIN } } as unknown as string[]);
      let opened = false;
      let ttft = 0;
      let resend: ReturnType<typeof setInterval> | undefined;
      const chatReq = JSON.stringify({ type: "chat_request", id: "c-bench", text: "ping", context: null, mode: "educational" });
      const cleanup = (): void => {
        clearTimeout(timer);
        if (resend) clearInterval(resend);
        try { ws.close(); } catch {}
      };
      const complete = (): boolean => ttft > 0 && STAGE_NAMES.size === Object.keys(stages).length;
      const done = (): void => {
        if (complete()) {
          cleanup();
          resolve({ ttft_ms: ttft, stages: stages as StageBreakdown });
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        // Opened but the turn never completed → fail loudly rather than median a
        // partial (0 ttft / undefined stages) sample. Never opened → retry the connect.
        if (opened) reject(new Error(`turn incomplete before deadline (ttft=${ttft}, stages=${Object.keys(stages).join(",")})`));
        else resolve(null);
      }, Math.max(0, end - Date.now()));
      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify({ type: "hello" }));
        ws.send(chatReq);
        // On a COLD spawn, createAgentSession (hence ChatHandler.attach) completes AFTER
        // hello_ack, so an early chat_request is dropped by the not-yet-attached worker.
        // Resend until the first chat_delta; once a turn is streaming, extra requests get
        // a harmless "session busy" reply (ignored here).
        resend = setInterval(() => {
          if (ttft === 0) { try { ws.send(chatReq); } catch {} }
        }, 400);
      };
      ws.onmessage = ev => {
        const m = JSON.parse(String(ev.data)) as { type?: string; stage?: string; ms?: number };
        if (m.type === "chat_delta" && ttft === 0) {
          ttft = (Bun.nanoseconds() - t0) / 1e6;
          if (resend) clearInterval(resend);
          done();
        } else if (m.type === "span" && typeof m.stage === "string" && typeof m.ms === "number" && STAGE_NAMES.has(m.stage)) {
          (stages as Record<string, number>)[m.stage] = m.ms;
          done();
        }
      };
      ws.onerror = () => {
        cleanup();
        if (opened) reject(new Error("ws error after open before turn completed"));
        else resolve(null);
      };
      ws.onclose = () => { if (!opened) { cleanup(); resolve(null); } };
    });
    if (sample !== null) return sample;
    await sleep(150);
  }
  throw new Error("worker never accepted a connection before the deadline");
}

async function runOnce(poolSize: string, portRe: RegExp): Promise<{ sample: RunSample; attr: Record<string, number> }> {
  const mgr = spawnManager(poolSize);
  try {
    await waitForSocket(mgr.sock, 10_000); // manager must bind its control socket before we provision
    if (poolSize !== "0") await sleep(2500); // let the spare finish booting so provision adopts it
    const t0 = Bun.nanoseconds();
    await sendProvision(mgr.sock);
    const port = await waitForPort(mgr.getErr, portRe, CONNECT_DEADLINE_MS);
    const sample = await connectAndMeasure(port, t0, TURN_DEADLINE_MS);
    // TTFT A1: let the worker finish the turn and flush its `[ttft-attr]` file appends
    // before we read. Fresh manager+dir per run ⇒ the attr file is per-run isolated;
    // parseAttrLines keeps the first occurrence per stage, so the 400ms chat_request
    // resends don't corrupt it. (Routing via manager-stderr pipe hung the turn — file only.)
    await sleep(300);
    const attr = fs.existsSync(mgr.attrFile)
      ? parseAttrLines(fs.readFileSync(mgr.attrFile, "utf8").split("\n"))
      : {};
    return { sample, attr };
  } finally {
    mgr.kill();
    await sleep(200);
  }
}

interface ModeRun {
  mode: ModeResult;
  attribution: Record<string, number>; // TTFT A1: median per-stage `[ttft-attr]`, NOT in the baseline
}

async function runMode(poolSize: string, portRe: RegExp, runs: number): Promise<ModeRun> {
  const samples: RunSample[] = [];
  const attrRecords: Record<string, number>[] = [];
  for (let i = 0; i < runs + 1; i++) {
    const { sample, attr } = await runOnce(poolSize, portRe);
    if (i > 0) {
      samples.push(sample); // discard a warm-up run
      attrRecords.push(attr);
    }
  }
  const pick = (f: (s: RunSample) => number): number => median(samples.map(f));
  return {
    mode: {
      ttft_ms: pick(s => s.ttft_ms),
      stages: {
        manager_provision: pick(s => s.stages.manager_provision),
        worker_boot: pick(s => s.stages.worker_boot),
        session_build: pick(s => s.stages.session_build),
        chat_handler: pick(s => s.stages.chat_handler),
        provider_ttft: pick(s => s.stages.provider_ttft),
      },
      runs,
    },
    attribution: medianByStage(attrRecords),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

const numArg = (name: string, def: number): number => {
  const v = arg(name);
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const runs = numArg("--runs", 5);
// Empirically tuned to this wall-clock micro-benchmark's noise floor (measured over
// repeated runs): sub-~15ms stages (warm worker_boot, manager_provision, chat_handler)
// jitter by several ms, and the agent-loop first-prompt provider_ttft swings ~±25%
// run-to-run. So the local gate requires BOTH a >30% relative AND a >15ms absolute
// regression — it catches gross regressions (the Phase-4 targets: cold worker_boot,
// provider_ttft) without false-positiving on ms/agent-loop noise. Override per-run with
// --tolerance / --min-abs-ms; the printed diff table always shows exact Δ% for finer judgment.
const tolerance = numArg("--tolerance", 30);
const minAbsMs = numArg("--min-abs-ms", 15);

const coldRun = await runMode("0", /provisioned tab-bench .* on port (\d+)/, runs);
const warmRun = await runMode("1", /adopted spare pid \d+ on port (\d+) as tab-bench/, runs);
const result: BenchResult = { cold: coldRun.mode, warm: warmRun.mode };

/**
 * TTFT A1: print a per-mode breakdown of `provider_ttft` from the worker's `[ttft-attr]`
 * lines. Additive stdout ONLY — never merged into `result`/the baseline, so `--check` /
 * `--update-baseline` stay byte-for-byte unchanged.
 *
 * `(unattributed)` = provider_ttft − sum(every stage EXCEPT the `ttft.agent-loop-total`
 * roll-up). agent-loop-total wraps the six loop leaves (runloop-setup, sync/transform/
 * convert-to-llm, normalize-tools, stream-fn); summing it AND them would double-count, so
 * it is excluded from the additive sum but still shown as a row (report, don't hide).
 */
function printAttribution(label: string, providerTtft: number, attr: Record<string, number>): void {
  console.log(`\n=== ${label} provider_ttft attribution ===`);
  const sorted = Object.entries(attr).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || providerTtft <= 0) {
    console.log(providerTtft <= 0 ? "  no attribution captured (provider_ttft is 0)" : "  no attribution captured");
    return;
  }
  console.log(`provider_ttft: ${providerTtft.toFixed(1)}ms`);
  const row = (name: string, ms: number): string =>
    `  ${name.padEnd(30)} ${ms.toFixed(1).padStart(8)}ms  (${((ms / providerTtft) * 100).toFixed(1)}%)`;
  for (const [stage, ms] of sorted) console.log(row(stage, ms));
  const accounted = sorted.reduce((s, [stage, ms]) => (stage === "ttft.agent-loop-total" ? s : s + ms), 0);
  console.log(row("(unattributed)", providerTtft - accounted));
}

printAttribution("cold", result.cold.stages.provider_ttft, coldRun.attribution);
printAttribution("warm", result.warm.stages.provider_ttft, warmRun.attribution);

if (flag("--update-baseline")) {
  fs.writeFileSync(BASELINE, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`baseline updated → ${path.relative(process.cwd(), BASELINE)}`);
  process.exit(0);
}

const outFile = arg("--out");
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

if (flag("--check")) {
  if (!fs.existsSync(BASELINE)) {
    console.error(`no baseline at ${path.relative(process.cwd(), BASELINE)} — run with --update-baseline first`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as BenchResult;
  const regs = compareToBaseline(baseline, result, tolerance, minAbsMs);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n=== regression check (tolerance ${tolerance}% + ${minAbsMs}ms floor) ===`);
  for (const mode of ["cold", "warm"] as const) {
    for (const k of [
      "ttft_ms",
      "manager_provision",
      "worker_boot",
      "session_build",
      "chat_handler",
      "provider_ttft",
    ] as const) {
      // A pre-session_build baseline lacks this key — treat missing as 0 so the row
      // prints (and does not gate) until the baseline is regenerated.
      const b = (k === "ttft_ms" ? baseline[mode].ttft_ms : baseline[mode].stages[k]) ?? 0;
      const c = (k === "ttft_ms" ? result[mode].ttft_ms : result[mode].stages[k]) ?? 0;
      const d = b === 0 ? 0 : ((c - b) / b) * 100;
      console.log(`  ${mode}.${k}: ${b.toFixed(1)} → ${c.toFixed(1)} (${d >= 0 ? "+" : ""}${d.toFixed(1)}%)`);
    }
  }
  if (regs.length > 0) {
    console.error(`\nREGRESSION: ${regs.map(r => `${r.metric} +${r.deltaPct.toFixed(1)}%`).join(", ")}`);
    process.exit(1);
  }
  console.log("\nOK — within tolerance");
  process.exit(0);
}

console.log(JSON.stringify(result, null, 2));
process.exit(0);

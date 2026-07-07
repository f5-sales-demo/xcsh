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

function spawnManager(poolSize: string): { sock: string; getErr: () => string; kill: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-ttft-"));
  const sock = path.join(dir, "manager.sock");
  const proc = Bun.spawn(["bun", CLI, "manager"], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, XCSH_MANAGER_SOCK: sock, XCSH_WORKER_POOL_SIZE: poolSize, XCSH_BENCH_EXTENSION: EXT },
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
  return { sock, getErr: () => err, kill: () => { try { proc.kill(); } catch {} } };
}

async function sendProvision(sock: string): Promise<void> {
  const c = await Bun.connect({ unix: sock, socket: { data() {} } });
  c.write(`${JSON.stringify({ type: "provision", sessionId: "tab-bench", tenant: "acme", env: "production" })}\n`);
  await sleep(50);
  c.end();
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

const STAGE_NAMES = new Set(["manager_provision", "worker_boot", "chat_handler", "provider_ttft"]);

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
      const complete = (): boolean => ttft > 0 && STAGE_NAMES.size === Object.keys(stages).length;
      const done = (): void => {
        if (complete()) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve({ ttft_ms: ttft, stages: stages as StageBreakdown });
        }
      };
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        // Opened but the turn never completed → fail loudly rather than median a
        // partial (0 ttft / undefined stages) sample. Never opened → retry the connect.
        if (opened) reject(new Error(`turn incomplete before deadline (ttft=${ttft}, stages=${Object.keys(stages).join(",")})`));
        else resolve(null);
      }, Math.max(0, end - Date.now()));
      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify({ type: "hello" }));
        ws.send(JSON.stringify({ type: "chat_request", id: "c-bench", text: "ping", context: null, mode: "educational" }));
      };
      ws.onmessage = ev => {
        const m = JSON.parse(String(ev.data)) as { type?: string; stage?: string; ms?: number };
        if (m.type === "chat_delta" && ttft === 0) { ttft = (Bun.nanoseconds() - t0) / 1e6; done(); }
        else if (m.type === "span" && typeof m.stage === "string" && typeof m.ms === "number" && STAGE_NAMES.has(m.stage)) {
          (stages as Record<string, number>)[m.stage] = m.ms; done();
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        if (opened) reject(new Error("ws error after open before turn completed"));
        else resolve(null);
      };
      ws.onclose = () => { if (!opened) { clearTimeout(timer); resolve(null); } };
    });
    if (sample !== null) return sample;
    await sleep(150);
  }
  throw new Error("worker never accepted a connection before the deadline");
}

async function runOnce(poolSize: string, portRe: RegExp): Promise<RunSample> {
  const mgr = spawnManager(poolSize);
  try {
    if (poolSize !== "0") await sleep(2500); // let the spare finish booting so provision adopts it
    const t0 = Bun.nanoseconds();
    await sendProvision(mgr.sock);
    const port = await waitForPort(mgr.getErr, portRe, CONNECT_DEADLINE_MS);
    return await connectAndMeasure(port, t0, TURN_DEADLINE_MS);
  } finally {
    mgr.kill();
    await sleep(200);
  }
}

async function runMode(poolSize: string, portRe: RegExp, runs: number): Promise<ModeResult> {
  const samples: RunSample[] = [];
  for (let i = 0; i < runs + 1; i++) {
    const s = await runOnce(poolSize, portRe);
    if (i > 0) samples.push(s); // discard a warm-up run
  }
  const pick = (f: (s: RunSample) => number): number => median(samples.map(f));
  return {
    ttft_ms: pick(s => s.ttft_ms),
    stages: {
      manager_provision: pick(s => s.stages.manager_provision),
      worker_boot: pick(s => s.stages.worker_boot),
      chat_handler: pick(s => s.stages.chat_handler),
      provider_ttft: pick(s => s.stages.provider_ttft),
    },
    runs,
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
const tolerance = numArg("--tolerance", 15);

const result: BenchResult = {
  cold: await runMode("0", /provisioned tab-bench .* on port (\d+)/, runs),
  warm: await runMode("1", /adopted spare pid \d+ on port (\d+) as tab-bench/, runs),
};

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
  const regs = compareToBaseline(baseline, result, tolerance);
  console.log(JSON.stringify(result, null, 2));
  console.log(`\n=== regression check (tolerance ${tolerance}%) ===`);
  for (const mode of ["cold", "warm"] as const) {
    for (const k of ["ttft_ms", "manager_provision", "worker_boot", "chat_handler", "provider_ttft"] as const) {
      const b = k === "ttft_ms" ? baseline[mode].ttft_ms : baseline[mode].stages[k];
      const c = k === "ttft_ms" ? result[mode].ttft_ms : result[mode].stages[k];
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

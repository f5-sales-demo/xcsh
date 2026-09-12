import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ReviewedActionDialog } from "../src/modes/components/reviewed-action-dialog";
import { getCurrentThemeName, setSymbolPreset, setTheme } from "../src/modes/theme/theme";
import { writeTerminalCapture } from "./terminal-capture";

// Synthetic component evidence only: no browser, credentials, or persisted user settings.
const root = resolve(import.meta.dir, "../../..");
const output = await mkdtemp(join(tmpdir(), "xcsh-review-captures-"));
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
const diff = Bun.spawnSync(["git", "diff", "--binary", "HEAD"], { cwd: root });
if (revision.exitCode || diff.exitCode) throw new Error("Cannot establish capture provenance");
const hash = createHash("sha256").update(diff.stdout);
for (const pattern of [
	"packages/coding-agent/src/modes/**/*.ts",
	"packages/coding-agent/src/config/**/*.ts",
	"packages/tui/src/**/*.ts",
	"packages/coding-agent/scripts/*capture*.ts",
])
	for (const file of [...new Bun.Glob(pattern).scanSync({ cwd: root })].sort())
		hash.update(file).update(await Bun.file(join(root, file)).bytes());
const fingerprint = hash.digest("hex");
let count = 0;
for (const theme of ["xcsh-dark", "xcsh-light"])
	for (const symbols of ["unicode", "ascii"] as const)
		for (const [columns, rows] of [
			[60, 20],
			[80, 24],
			[100, 32],
			[140, 40],
		]) {
			await setSymbolPreset(symbols);
			if (!(await setTheme(theme)).success || getCurrentThemeName() !== theme)
				throw new Error("Wrong capture theme");
			const review = {
				identity: "session:synthetic-review-fixture",
				scope: "Current session · Global defaults unchanged",
				revision: "INTERNAL_SNAPSHOT_NOT_FOR_DISPLAY",
				changes: [{ field: "Service tier", before: "default", after: "priority" }],
				consequence:
					"Applies to subsequent supported requests. Priority service may cost more; provider support determines its effect.",
			};
			let reject!: (reason: Error) => void;
			let started!: () => void;
			const executing = new Promise<void>(resolve => {
				started = resolve;
			});
			const pending = new Promise<void>((_resolve, fail) => {
				reject = fail;
			});
			const dialog = new ReviewedActionDialog(
				"fast mode",
				{
					review,
					resolve: async () => ({ review, target: true }),
					execute: async () => {
						started();
						await pending;
					},
				},
				() => {},
				() => {},
				() => rows,
			);
			const capture = async (state: string, actions: string[], expected: string, component = dialog) => {
				const lines = component.render(columns);
				if (lines.join("\n").includes(review.revision)) throw new Error("Internal revision leaked");
				await writeTerminalCapture(
					output,
					`${state}-${columns}x${rows}-${theme}-${symbols}`,
					lines,
					{ columns, rows },
					theme === "xcsh-dark"
						? { foreground: "#d8dee9", background: "#1f2430" }
						: { foreground: "#2e3440", background: "#f7f7f5" },
					{
						fixture: "reviewed-action-synthetic-v2",
						theme,
						symbols,
						state,
						actions,
						expected,
						observed: { renderedRows: lines.length, internalRevisionHidden: true },
						revision: revision.stdout.toString().trim(),
						fingerprint,
						fingerprintScope: "tracked diff plus mode/config/TUI/capture sources",
						persistenceProof: false,
						baseline: "candidate fixture, not historical baseline",
					},
				);
				count++;
			};
			await capture(
				"review",
				["open synthetic fast-mode review"],
				"Cancel selected; target, scope, old/new and consequences visible",
			);
			const changed = {
				...review,
				revision: "CHANGED_INTERNAL_SNAPSHOT",
				consequence: "Updated provider cost warning.",
			};
			const warning = new ReviewedActionDialog(
				"fast mode",
				{
					review,
					resolve: async () => ({ review: changed, target: true }),
					execute: async () => {
						throw new Error("Stale proposal must not execute");
					},
				},
				() => {},
				() => {},
				() => rows,
			);
			warning.handleInput("\x1b[B");
			warning.handleInput("\r");
			for (
				let attempt = 0;
				attempt < 100 && !Bun.stripANSI(warning.render(columns).join("\n")).includes("proposal changed");
				attempt++
			)
				await Bun.sleep(1);
			if (!Bun.stripANSI(warning.render(columns).join("\n")).includes("proposal changed"))
				throw new Error("Changed-proposal warning did not settle");
			await capture(
				"warning",
				["confirm stale proposal", "revalidate changed cost consequence"],
				"Warning is distinct from execution failure; Cancel selected and renewed values visible",
				warning,
			);
			dialog.handleInput("\x1b[B");
			dialog.handleInput("\r");
			await executing;
			await capture(
				"progress",
				["select Confirm change", "submit"],
				"Tracked non-cancellable operation; no false cancellation hint",
			);
			reject(new Error("Synthetic storage unavailable. State may have changed; retry only unresolved saving."));
			for (
				let i = 0;
				i < 100 && !Bun.stripANSI(dialog.render(columns).join("\n")).includes("Synthetic storage unavailable");
				i++
			)
				await Bun.sleep(1);
			if (!Bun.stripANSI(dialog.render(columns).join("\n")).includes("Synthetic storage unavailable"))
				throw new Error("Failure scenario did not settle");
			await capture(
				"failure",
				["confirmed operation rejects with synthetic storage error"],
				"Unresolved result retained; retry and close available",
			);
		}
console.log(JSON.stringify({ output, captures: count, fingerprint }));

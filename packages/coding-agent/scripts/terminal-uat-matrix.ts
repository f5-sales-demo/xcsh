import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Serial runs keep every PTY isolated and avoid introducing load-sensitive interaction races.
const args = process.argv.slice(2);
if (
	args.length > 1 ||
	(args.length === 1 &&
		![
			"--force-fixture",
			"--route-fixture",
			"--plan-fixture",
			"--export-fixture",
			"--publication-fixture",
			"--copy-fixture",
			"--memory-fixture",
			"--compact-fixture",
			"--reload-plugins-fixture",
			"--background-fixture",
			"--exit-fixture",
			"--browser-fixture",
			"--reports-fixture",
			"--foundation-fixture",
			"--plugin-fixture",
			"--inventories-fixture",
			"--sessions-fixture",
			"--resources-fixture",
			"--connections-fixture",
		].includes(args[0]))
)
	throw new Error(
		"Usage: terminal-uat-matrix.ts [--force-fixture|--route-fixture|--plan-fixture|--export-fixture|--publication-fixture|--copy-fixture|--memory-fixture|--compact-fixture|--reload-plugins-fixture|--background-fixture|--exit-fixture|--browser-fixture|--reports-fixture|--foundation-fixture|--plugin-fixture|--inventories-fixture|--sessions-fixture|--resources-fixture|--connections-fixture]",
	);
const fixture =
	args[0] === "--connections-fixture"
		? "connections"
		: args[0] === "--resources-fixture"
			? "resources-artifacts"
			: args[0] === "--sessions-fixture"
				? "sessions"
				: args[0] === "--inventories-fixture"
					? "settings-inventories"
					: args[0] === "--plugin-fixture"
						? "plugin-lifecycle"
						: args[0] === "--foundation-fixture"
							? "foundation-login-model"
							: args[0] === "--reports-fixture"
								? "reports"
								: args[0] === "--publication-fixture"
									? "publication-launcher"
									: args[0] === "--browser-fixture"
										? "browser-chrome"
										: args[0] === "--export-fixture"
											? "export"
											: args[0] === "--copy-fixture"
												? "copy-clipboard"
												: args[0] === "--compact-fixture"
													? "manual-compaction"
													: args[0] === "--reload-plugins-fixture"
														? "plugin-metadata-refresh"
														: args[0] === "--background-fixture"
															? "background-transfer"
															: args[0] === "--exit-fixture"
																? "reviewed-exit"
																: args[0] === "--memory-fixture"
																	? "memory-actions"
																	: args[0] === "--plan-fixture"
																		? "plan-mode"
																		: args[0] === "--route-fixture"
																			? "route-mode"
																			: args.length
																				? "force-read"
																				: "memory-fast";
const output = await mkdtemp(join(tmpdir(), "xcsh-terminal-matrix-"));
const runs: Array<Record<string, unknown>> = [];
console.log(`Matrix evidence: ${output}`);
for (const size of ["60x20", "80x24", "100x32", "140x40"])
	for (const theme of ["dark", "light"])
		for (const symbols of ["unicode", "ascii"]) {
			const name = `${size}-${theme}-${symbols}`;
			console.log(`Running ${name}`);
			const walkthrough = [
				process.execPath,
				join(import.meta.dir, "terminal-uat-walkthrough.ts"),
				...args,
				"--size",
				size,
				"--theme",
				theme,
				"--symbols",
				symbols,
			];
			const child = Bun.spawn(
				fixture === "copy-clipboard"
					? [
							"xvfb-run",
							"-a",
							"-s",
							"-screen 0 1280x1024x24",
							"env",
							"XCSH_UAT_ISOLATED_DISPLAY=1",
							...walkthrough,
						]
					: walkthrough,
				{ stdout: "pipe", stderr: "pipe" },
			);
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			await Bun.write(join(output, `${name}.stdout`), stdout);
			await Bun.write(join(output, `${name}.stderr`), stderr);
			let receipt: unknown;
			try {
				receipt = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
			} catch {
				/* Missing receipt is a failure. */
			}
			const parsed = receipt as { profile?: string; output?: string } | undefined;
			const passed = exitCode === 0 && parsed?.profile !== undefined && parsed.output !== undefined;
			if (passed) {
				const runOutput = join(output, name);
				await mkdir(runOutput);
				await cp(parsed.output!, join(runOutput, "evidence"), {
					recursive: true,
				});
				await cp(join(parsed.profile!, "walkthrough.json"), join(runOutput, "walkthrough.json"));
				await cp(join(parsed.profile!, "terminal-events.ansi"), join(runOutput, "terminal-events.ansi"));
				receipt = {
					...(receipt as Record<string, unknown>),
					profile: "isolated disposable profile not preserved",
					output: `${name}/evidence`,
					walkthrough: `${name}/walkthrough.json`,
					terminalEvents: `${name}/terminal-events.ansi`,
				};
			}
			runs.push({
				name,
				size,
				theme,
				symbols,
				exitCode,
				passed,
				receipt,
				visualVerdict: "unexamined",
			});
			await Bun.write(
				join(output, "matrix.json"),
				JSON.stringify({ fixture, runs, complete: runs.length === 16 }, null, 2),
			);
			console.log(`${passed ? "PASS interaction" : "FAIL"} ${name}`);
		}
process.exitCode = runs.every(run => run.passed) ? 0 : 1;

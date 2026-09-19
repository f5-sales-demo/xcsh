import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../../../..");
const accountHelper = path.join(root, "scripts/ci-macos-uat-user.sh");
const upgradeHelper = path.join(root, "scripts/ci-homebrew-upgrade-fixture.sh");

async function executable(file: string, source: string): Promise<void> {
	await Bun.write(file, source);
	await fs.chmod(file, 0o755);
}

async function runAccountScenario(options: {
	status?: number;
	visibleAfter?: number;
	neverVisible?: boolean;
	preExisting?: boolean;
	administrator?: boolean;
}) {
	const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "xcsh-macos-uat-user-"));
	const bin = path.join(fixture, "bin");
	const home = path.join(fixture, "Users", "xcsh-uat");
	const created = path.join(fixture, "created");
	const count = path.join(fixture, "id-count");
	const calls = path.join(fixture, "calls.log");
	await fs.mkdir(bin, { recursive: true });

	await executable(
		path.join(bin, "sudo"),
		'#!/usr/bin/env bash\nset -euo pipefail\nprintf \'sudo %s\\n\' "$*" >>"$MOCK_CALLS"\nexec "$@"\n',
	);
	await executable(
		path.join(bin, "sysadminctl"),
		// biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell parameter expansion
		'#!/usr/bin/env bash\nset -u\ntouch "$MOCK_CREATED"\nexit "${MOCK_SYSADMINCTL_STATUS:-0}"\n',
	);
	await executable(
		path.join(bin, "id"),
		`#!/usr/bin/env bash
set -u
case "\${1:-}" in
  -u)
    if [[ "\${MOCK_PRE_EXISTING:-0}" == 1 ]]; then exit 0; fi
    if [[ ! -e "$MOCK_CREATED" || "\${MOCK_NEVER_VISIBLE:-0}" == 1 ]]; then exit 1; fi
    current=$(cat "$MOCK_ID_COUNT" 2>/dev/null || echo 0)
    current=$((current + 1))
    echo "$current" >"$MOCK_ID_COUNT"
    [[ "$current" -ge "\${MOCK_VISIBLE_AFTER:-1}" ]]
    ;;
  -un) printf '%s\\n' "$UAT_USER" ;;
  -Gn)
    if [[ "\${MOCK_ADMINISTRATOR:-0}" == 1 ]]; then echo "staff admin"; else echo "staff"; fi
    ;;
  *) exit 1 ;;
esac
`,
	);
	await executable(
		path.join(bin, "dscl"),
		"#!/usr/bin/env bash\nset -u\nprintf 'NFSHomeDirectory: %s\\n' \"$UAT_HOME\"\n",
	);
	await executable(path.join(bin, "stat"), "#!/usr/bin/env bash\nset -u\nprintf '%s\\n' \"$UAT_USER\"\n");
	await executable(path.join(bin, "chown"), "#!/usr/bin/env bash\nexit 0\n");
	await executable(path.join(bin, "uuidgen"), "#!/usr/bin/env bash\necho 00000000-0000-0000-0000-000000000000\n");
	await executable(path.join(bin, "sleep"), '#!/usr/bin/env bash\nprintf \'sleep %s\\n\' "$*" >>"$MOCK_CALLS"\n');

	const proc = Bun.spawn(["/bin/bash", accountHelper], {
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			UAT_USER: "xcsh-uat",
			UAT_HOME: home,
			UAT_FULL_NAME: "xcsh UAT",
			UAT_READY_TIMEOUT_SECONDS: "2",
			UAT_READY_POLL_SECONDS: "1",
			MOCK_SYSADMINCTL_STATUS: String(options.status ?? 0),
			MOCK_VISIBLE_AFTER: String(options.visibleAfter ?? 1),
			MOCK_NEVER_VISIBLE: options.neverVisible ? "1" : "0",
			MOCK_PRE_EXISTING: options.preExisting ? "1" : "0",
			MOCK_ADMINISTRATOR: options.administrator ? "1" : "0",
			MOCK_CREATED: created,
			MOCK_ID_COUNT: count,
			MOCK_CALLS: calls,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	const callLog = await fs.readFile(calls, "utf8").catch(() => "");
	await fs.rm(fixture, { recursive: true, force: true });
	return { exitCode, output: stdout + stderr, callLog };
}

describe("shared macOS UAT account provisioning", () => {
	it("accepts an immediately visible account after successful sysadminctl", async () => {
		const result = await runAccountScenario({});
		expect(result.exitCode).toBe(0);
		expect(result.callLog).toContain("sudo sysadminctl -addUser xcsh-uat");
	});

	it("waits for delayed directory-service visibility", async () => {
		const result = await runAccountScenario({ visibleAfter: 3 });
		expect(result.exitCode).toBe(0);
		expect(result.callLog.match(/sleep 1/g)?.length).toBe(2);
	});

	it("accepts a partial sysadminctl status only after complete validation", async () => {
		const result = await runAccountScenario({ status: 1 });
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("sysadminctl status 1 accepted after account readiness validation");
	});

	it("reports the captured status and readiness diagnostics for a missing account", async () => {
		const result = await runAccountScenario({ status: 1, neverVisible: true });
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("sysadminctl status: 1");
		expect(result.output).toContain("readiness: account is not visible");
	});

	it("rejects a pre-existing account without invoking sysadminctl", async () => {
		const result = await runAccountScenario({ preExisting: true });
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("already exists");
		expect(result.callLog).not.toContain("sysadminctl");
	});

	it("rejects an administrator account", async () => {
		const result = await runAccountScenario({ administrator: true });
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("administrator");
	});
});

async function runUpgradeFixture(layout: "arm64" | "intel") {
	const fixture = await fs.mkdtemp(path.join(os.tmpdir(), `xcsh-homebrew-${layout}-`));
	const bin = path.join(fixture, "bin");
	const prefix = path.join(fixture, layout === "arm64" ? "opt/homebrew" : "usr/local");
	const repository = path.join(
		fixture,
		layout === "arm64"
			? "opt/homebrew/Library/Taps/xcsh-uat/homebrew-baseline"
			: "usr/local/Homebrew/Library/Taps/xcsh-uat/homebrew-baseline",
	);
	const calls = path.join(fixture, "brew.log");
	await fs.mkdir(bin, { recursive: true });
	await executable(
		path.join(bin, "brew"),
		`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$MOCK_BREW_CALLS"
case "\${1:-}" in
  --prefix) printf '%s\\n' "$MOCK_BREW_PREFIX" ;;
  --repository) printf '%s\\n' "$MOCK_TAP_REPOSITORY" ;;
  install)
    mkdir -p "$MOCK_BREW_PREFIX/bin"
    printf '#!/usr/bin/env bash\\necho xcsh/%s\\n' "$BASELINE_VERSION" >"$MOCK_BREW_PREFIX/bin/xcsh"
    chmod +x "$MOCK_BREW_PREFIX/bin/xcsh"
    ;;
esac
`,
	);

	const proc = Bun.spawn(["/bin/bash", upgradeHelper], {
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			BASELINE_VERSION: "21.32.0",
			BASELINE_SHA256: "a".repeat(64),
			RELEASE_ARCH: layout === "arm64" ? "arm64" : "x64",
			MOCK_BREW_PREFIX: prefix,
			MOCK_TAP_REPOSITORY: repository,
			MOCK_BREW_CALLS: calls,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	const callLog = await fs.readFile(calls, "utf8").catch(() => "");
	const cask = await fs.readFile(path.join(repository, "Casks/xcsh.rb"), "utf8").catch(() => "");
	await fs.rm(fixture, { recursive: true, force: true });
	return { exitCode, output: stdout + stderr, callLog, cask };
}

describe("Homebrew immutable-baseline upgrade fixture", () => {
	for (const layout of ["arm64", "intel"] as const) {
		it(`resolves the ${layout} tap repository and uses qualified cask tokens`, async () => {
			const result = await runUpgradeFixture(layout);
			expect(result.exitCode).toBe(0);
			expect(result.cask).toContain('version "21.32.0"');
			expect(result.callLog).toContain("--repository xcsh-uat/baseline");
			expect(result.callLog).toContain("install --cask xcsh-uat/baseline/xcsh");
			expect(result.callLog).toContain("upgrade --cask f5-sales-demo/tap/xcsh");
			expect(result.callLog).not.toMatch(/^upgrade --cask xcsh$/m);
		});
	}
});

import { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

export const HERDR_ACCEPTANCE_VERSION = 1;
export const HERDR_ACCEPTANCE_PLAN_ENV = "XCSH_HERDR_ACCEPTANCE_PLAN";
export const HERDR_ACCEPTANCE_ACTIONS = ["release", "reconnect_replay", "restart_loss"] as const;
type Action = (typeof HERDR_ACCEPTANCE_ACTIONS)[number];
type Json = Record<string, unknown>;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const executableDigest = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function privateJson(file: string): Json {
	if (!path.isAbsolute(file)) throw new Error("Acceptance paths must be absolute");
	const stat = fs.lstatSync(file);
	if (!stat.isFile()) throw new Error("Acceptance input must be a regular file");
	if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
		throw new Error("Acceptance input must be owner-private");
	const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Acceptance input must be an object");
	return value as Json;
}

function privateWrite(file: string, value: unknown): void {
	const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
	const fd = fs.openSync(temporary, "wx", 0o600);
	try {
		fs.writeFileSync(fd, `${JSON.stringify(value)}\n`);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(temporary, file);
	const directory = fs.openSync(path.dirname(file), "r");
	try {
		fs.fsyncSync(directory);
	} finally {
		fs.closeSync(directory);
	}
}

/** A claim survives process loss. Only completed, byte-bound requests replay. */
export class AcceptanceClaims {
	readonly db: Database;
	constructor(file: string) {
		if (fs.existsSync(file)) privateJsonDatabase(file);
		else fs.closeSync(fs.openSync(file, "wx", 0o600));
		this.db = new Database(file);
		this.db.exec(
			"PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS claims (key TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL, receipt TEXT)",
		);
	}
	state(key: string): string | undefined {
		return (this.db.query("SELECT state FROM claims WHERE key=?").get(key) as { state: string } | null)?.state;
	}
	async run(key: string, request: unknown, effect: () => Promise<Json>): Promise<Json> {
		const hash = digest(request);
		const prior = this.db
			.transaction(() => {
				const row = this.db.query("SELECT digest,state,receipt FROM claims WHERE key=?").get(key) as {
					digest: string;
					state: string;
					receipt: string;
				} | null;
				if (row) {
					if (row.digest !== hash) throw new Error("Acceptance action key conflicts with its immutable request");
					if (row.state !== "completed")
						throw new Error("Acceptance action outcome is uncertain; reconcile before retry");
					return JSON.parse(row.receipt) as Json;
				}
				this.db.query("INSERT INTO claims VALUES(?,?,'claimed',NULL)").run(key, hash);
				return undefined;
			})
			.immediate();
		if (prior) return prior;
		const receipt = await effect();
		this.db.query("UPDATE claims SET state='completed',receipt=? WHERE key=?").run(JSON.stringify(receipt), key);
		return receipt;
	}
	close(): void {
		this.db.close();
	}
}

function privateJsonDatabase(file: string): void {
	const stat = fs.lstatSync(file);
	if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
		throw new Error("Acceptance claims must be owner-private regular files");
}

/** Called at the producer's transport boundary while the journal event is pending. */
export async function replayAcceptedResponse(
	frame: Json,
	request: (frame: Json) => Promise<Json>,
): Promise<{ response: Json; receipt: Json }> {
	const hash = digest(frame);
	const first = await request(frame);
	if (first.type !== "agent_turn" || first.admitted !== true)
		throw new Error("Reply-loss cutpoint requires a real newly admitted journal response");
	// Deliberately withhold the accepted response from the reporter. Its pending
	// event remains undelivered until the identical transport request is accepted.
	const second = await request(frame);
	if (digest(frame) !== hash || second.type !== "agent_turn" || second.admitted !== false)
		throw new Error("Reply-loss replay did not confirm an identical deduplicated event");
	const firstTurn = first.turn as Json | undefined;
	const secondTurn = second.turn as Json | undefined;
	const bindingKeys = [
		"execution_id",
		"pane_id",
		"producer",
		"session_id",
		"turn_id",
		"generation",
		"event_revision",
		"state",
	];
	if (
		!firstTurn ||
		!secondTurn ||
		!Number.isSafeInteger(firstTurn.revision) ||
		firstTurn.revision !== secondTurn.revision ||
		bindingKeys.some(key => firstTurn[key] !== frame[key] || secondTurn[key] !== frame[key])
	)
		throw new Error("Reply-loss replay changed journal revision");
	// Only digests and server acknowledgements are evidence; native capability
	// remains in the ephemeral request and is never copied into these receipts.
	const safeAck = (response: Json): Json => ({
		type: response.type,
		admitted: response.admitted,
		revision: (response.turn as Json).revision,
	});
	return {
		response: second,
		receipt: {
			response_discarded: true,
			payload_sha256: hash,
			replay_payload_sha256: hash,
			acknowledgements: [safeAck(first), safeAck(second)],
		},
	};
}

export interface AcceptanceBinding {
	execution_id: string;
	pane_id: string;
	session_id: string;
	generation: number;
	turn_id: string;
	pid: number;
	executable: string;
	executable_sha256: string;
	journal_revision: number;
}

interface AcceptanceHooks {
	replay(): Promise<void>;
	shutdown(): void;
}

/** Exists only inside an explicitly approved disposable producer process. */
export class HerdrAcceptanceControl {
	readonly directory: string;
	readonly token = randomBytes(32).toString("hex");
	readonly claims: AcceptanceClaims;
	readonly actions: Action[];
	descriptor: Json | undefined;
	server: net.Server | undefined;
	releaseBoundary: (() => void) | undefined;
	shutdownReceipt: ((receipt: Json) => void) | undefined;
	replayArmed = false;
	replayReceipt: Json | undefined;
	paused = false;
	shutdownPending = false;
	effectTail: Promise<void> = Promise.resolve();
	static forSession(planFile: string, sessionId: string): HerdrAcceptanceControl | undefined {
		const plan = privateJson(planFile);
		if (plan.version !== HERDR_ACCEPTANCE_VERSION || !Array.isArray(plan.approvals))
			throw new Error("Unsupported Herdr acceptance plan");
		return (plan.approvals as Json[]).some(approval => approval.session_id === sessionId)
			? new HerdrAcceptanceControl(planFile, sessionId)
			: undefined;
	}
	constructor(
		readonly planFile: string,
		readonly sessionId: string,
	) {
		if (process.platform !== "linux") throw new Error("Herdr acceptance control currently requires Linux");
		const plan = privateJson(planFile);
		if (plan.version !== HERDR_ACCEPTANCE_VERSION || !Array.isArray(plan.approvals))
			throw new Error("Unsupported Herdr acceptance plan");
		this.directory = String(plan.control_directory);
		const dir = fs.lstatSync(this.directory);
		if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) !== 0 || dir.uid !== process.getuid?.())
			throw new Error("Acceptance directory must be owner-private");
		const executable = fs.realpathSync(process.execPath);
		const hash = executableDigest(executable);
		const approval = (plan.approvals as Json[]).find(
			item => item.session_id === sessionId && item.executable === executable && item.executable_sha256 === hash,
		);
		if (
			!approval ||
			!Array.isArray(approval.actions) ||
			approval.actions.some(action => !HERDR_ACCEPTANCE_ACTIONS.includes(action as Action))
		)
			throw new Error("Producer session/executable/action is not approved");
		this.actions = approval.actions as Action[];
		this.claims = new AcceptanceClaims(path.join(this.directory, "claims.sqlite"));
	}

	async workingBoundary(binding: AcceptanceBinding, hooks: AcceptanceHooks): Promise<void> {
		if (this.paused) return;
		this.paused = true;
		const socket = path.join(this.directory, `${process.pid}.sock`);
		const descriptorFile = path.join(this.directory, `${this.sessionId}.${binding.generation}.${process.pid}.json`);
		this.descriptor = {
			version: HERDR_ACCEPTANCE_VERSION,
			binding,
			socket,
			descriptor_file: descriptorFile,
			plan_file: this.planFile,
			control_token: this.token,
			actions: this.actions,
			boundary: "working",
		};
		const boundary = new Promise<void>(resolve => {
			this.releaseBoundary = resolve;
		});
		this.server = net.createServer(connection => {
			let buffer = "";
			connection.setTimeout(30_000, () => connection.destroy());
			connection.on("error", () => {});
			connection.on("data", chunk => {
				buffer += chunk.toString();
				if (buffer.length > 64_000) {
					connection.destroy();
					return;
				}
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				connection.pause();
				void Promise.resolve()
					.then(() => this.act(JSON.parse(buffer.slice(0, newline)) as Json, hooks))
					.then(
						receipt => connection.end(`${JSON.stringify({ ok: true, receipt })}\n`),
						error => connection.end(`${JSON.stringify({ ok: false, error: String(error) })}\n`),
					);
			});
		});
		await new Promise<void>((resolve, reject) => {
			this.server!.once("error", reject);
			this.server!.listen(socket, resolve);
		});
		fs.chmodSync(socket, 0o600);
		privateWrite(descriptorFile, this.descriptor);
		await boundary;
	}

	async act(request: Json, hooks: AcceptanceHooks): Promise<Json> {
		const supplied = Buffer.from(String(request.control_token));
		const expected = Buffer.from(this.token);
		if (
			supplied.length !== expected.length ||
			!timingSafeEqual(supplied, expected) ||
			request.version !== HERDR_ACCEPTANCE_VERSION
		)
			throw new Error("Acceptance authentication/binding rejected");
		const action = request.action as Action;
		if (!this.actions.includes(action) || typeof request.action_key !== "string" || !request.action_key)
			throw new Error("Acceptance action is not approved");
		// Never persist tokens. The request hash binds the public request fields.
		const { control_token: _token, ...safeRequest } = request;
		const previous = this.effectTail;
		let releaseEffect!: () => void;
		this.effectTail = new Promise<void>(resolve => {
			releaseEffect = resolve;
		});
		await previous;
		try {
			const receipt = await this.claims.run(request.action_key, safeRequest, async () => {
				if (
					digest(request.binding) !== digest(this.descriptor?.binding) ||
					this.descriptor?.boundary !== "working" ||
					request.descriptor_file !== this.descriptor.descriptor_file
				)
					throw new Error("Acceptance working boundary or observed journal revision changed");
				let effect: Json;
				if (action === "reconnect_replay") {
					this.replayArmed = true;
					this.replayReceipt = undefined;
					await hooks.replay();
					if (this.replayArmed || !this.replayReceipt)
						throw new Error("Producer replay did not reach its transport cutpoint");
					effect = this.replayReceipt;
				} else if (action === "restart_loss") {
					this.shutdownPending = true;
					const shutdown = new Promise<Json>(resolve => {
						this.shutdownReceipt = resolve;
					});
					hooks.shutdown();
					this.releaseBoundary?.();
					effect = await shutdown;
				} else {
					this.descriptor!.boundary = "released";
					this.releaseBoundary?.();
					effect = { working_boundary_released: true };
				}
				const receipt = {
					version: HERDR_ACCEPTANCE_VERSION,
					action,
					action_key_sha256: digest(request.action_key),
					binding: request.binding,
					effect: {
						...effect,
						producer_session_id: (request.binding as Json).session_id,
						execution_id: (request.binding as Json).execution_id,
						producer_pid: (request.binding as Json).pid,
						before_revision: (request.binding as Json).journal_revision,
						action:
							action === "reconnect_replay"
								? "producer_report_reply_loss"
								: action === "restart_loss"
									? "producer_process_cutpoint"
									: "producer_boundary_release",
						...(action === "reconnect_replay" ? { redelivered: true } : {}),
					},
				};
				return receipt;
			});
			// Publication follows the committed claim, so a process loss in between
			// remains recoverable from SQLite and never replays an uncertain effect.
			privateWrite(path.join(this.directory, `${digest(request.action_key)}.receipt.json`), {
				request_sha256: digest(safeRequest),
				receipt,
			});
			return receipt;
		} finally {
			releaseEffect();
		}
	}

	async transport(frame: Json, request: (frame: Json) => Promise<Json>): Promise<Json> {
		if (!this.replayArmed) return request(frame);
		this.replayArmed = false;
		const replay = await replayAcceptedResponse(frame, request);
		this.replayReceipt = replay.receipt;
		if (this.descriptor) {
			(this.descriptor.binding as Json).journal_revision = (replay.response.turn as Json).revision;
			privateWrite(String(this.descriptor.descriptor_file), this.descriptor);
		}
		return replay.response;
	}

	observeShutdown(response: Json | undefined): void {
		if (this.descriptor) this.descriptor.boundary = "shutdown";
		const turn = response?.turn as Json | undefined;
		if (response?.type === "agent_turn" && turn?.state === "interrupted") {
			this.shutdownReceipt?.({
				shutdown_path: "session_shutdown",
				interrupted_acknowledgement: { revision: turn.revision, admitted: response.admitted, state: turn.state },
			});
		}
		this.releaseBoundary?.();
		this.server?.close();
	}
}

/** Released adapter verifies process exit itself; controller assertions are insufficient. */
export async function runHerdrAcceptanceAction(file: string): Promise<Json> {
	const request = privateJson(file);
	const descriptor = privateJson(String(request.descriptor_file));
	if (descriptor.version !== HERDR_ACCEPTANCE_VERSION || request.control_token !== descriptor.control_token)
		throw new Error("Acceptance descriptor/request binding rejected");
	const binding = descriptor.binding as unknown as AcceptanceBinding;
	if (
		fs.realpathSync(binding.executable) !== binding.executable ||
		executableDigest(binding.executable) !== binding.executable_sha256
	)
		throw new Error("Acceptance executable identity changed");
	const plan = privateJson(String(descriptor.plan_file));
	const receiptFile = path.join(String(plan.control_directory), `${digest(request.action_key)}.receipt.json`);
	const { control_token: _token, ...safeRequest } = request;
	let receipt: Json | undefined;
	const claimsFile = path.join(String(plan.control_directory), "claims.sqlite");
	privateJsonDatabase(claimsFile);
	const db = new Database(claimsFile, { readonly: true });
	try {
		const claim = db.query("SELECT digest,state,receipt FROM claims WHERE key=?").get(String(request.action_key)) as {
			digest: string;
			state: string;
			receipt: string;
		} | null;
		if (claim) {
			if (claim.digest !== digest(safeRequest)) throw new Error("Acceptance action conflicts with saved claim");
			if (claim.state !== "completed") throw new Error("Acceptance claim outcome is uncertain");
			receipt = JSON.parse(claim.receipt) as Json;
			if (fs.existsSync(receiptFile)) {
				const saved = privateJson(receiptFile);
				if (saved.request_sha256 !== claim.digest || JSON.stringify(saved.receipt) !== claim.receipt)
					throw new Error("Acceptance claim conflicts with its saved receipt");
			} else privateWrite(receiptFile, { request_sha256: claim.digest, receipt });
		}
	} finally {
		db.close();
	}
	if (!receipt) {
		if (digest(request.binding) !== digest(descriptor.binding) || descriptor.boundary !== "working")
			throw new Error("Acceptance descriptor working boundary changed");
		receipt = await new Promise<Json>((resolve, reject) => {
			const socket = net.createConnection(String(descriptor.socket));
			let buffer = "";
			socket.setTimeout(30_000, () => socket.destroy(new Error("Acceptance action timed out")));
			socket.on("error", reject);
			socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
			socket.on("data", chunk => {
				buffer += chunk.toString();
				if (buffer.length > 64_000) {
					socket.destroy(new Error("Oversized acceptance receipt"));
					return;
				}
				if (!buffer.includes("\n")) return;
				try {
					const result = JSON.parse(buffer.split("\n")[0]!) as Json;
					if (result.ok !== true) throw new Error(String(result.error));
					resolve(result.receipt as Json);
					socket.end();
				} catch (error) {
					socket.destroy();
					reject(error);
				}
			});
			socket.on("end", () => {
				if (!buffer.includes("\n")) reject(new Error("Producer exited without a completed receipt"));
			});
		});
	}
	if (request.action === "restart_loss") {
		const deadline = Date.now() + 15_000;
		while (true) {
			try {
				process.kill(binding.pid, 0);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
				return {
					...receipt,
					effect: {
						...(receipt.effect as Json),
						producer_exit_verified: true,
						process_exited: true,
						exited_pid: binding.pid,
					},
				};
			}
			if (Date.now() >= deadline) throw new Error("Producer shutdown did not exit; restart receipt withheld");
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	}
	return receipt;
}

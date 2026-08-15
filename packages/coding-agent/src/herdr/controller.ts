import * as fs from "node:fs/promises";
import * as path from "node:path";
import { HerdrClient, HerdrProtocolError } from "./client";

export const HERDR_OWNER_TOKEN = "xcsh_owner";
const HERDR_SOURCE = "xcsh:terminal";

export interface HerdrTerminalRecordV1 {
	name: string;
	tabId: string;
	paneId: string;
	createdAt: string;
}

export interface HerdrBindingV1 {
	version: 1;
	sessionName: string;
	workspaceId: string;
	rootPaneId: string;
	ownerToken: string;
	activeSessionRef?: string;
	terminals: HerdrTerminalRecordV1[];
}

interface PaneInfo extends Record<string, unknown> {
	pane_id: string;
	tab_id: string;
	workspace_id: string;
	tokens?: Record<string, string>;
	focused?: boolean;
}

interface TabCreated extends Record<string, unknown> {
	type: "tab_created";
	tab: { tab_id: string; workspace_id: string; label?: string };
	root_pane: PaneInfo;
}

function bindingFromEnvironment(): HerdrBindingV1 | undefined {
	const sessionName = process.env.HERDR_SESSION;
	const workspaceId = process.env.HERDR_WORKSPACE_ID;
	const rootPaneId = process.env.HERDR_PANE_ID;
	const ownerToken = process.env.XCSH_HERDR_OWNER;
	if (!sessionName || !workspaceId || !rootPaneId || !ownerToken) return undefined;
	return {
		version: 1,
		sessionName,
		workspaceId,
		rootPaneId,
		ownerToken,
		terminals: [],
	};
}

export class HerdrController {
	private readonly lastInputAt = new Map<string, number>();
	private readonly busyClosePending = new Set<string>();
	private constructor(
		readonly client: HerdrClient,
		readonly bindingPath: string | undefined,
		readonly binding: HerdrBindingV1,
	) {}

	static async connect(options?: {
		socketPath?: string;
		bindingPath?: string;
		binding?: HerdrBindingV1;
	}): Promise<HerdrController> {
		const socketPath = options?.socketPath ?? process.env.HERDR_SOCKET_PATH;
		if (!socketPath) throw new HerdrProtocolError("terminal management is unavailable outside Herdr", "unavailable");
		const bindingPath = options?.bindingPath ?? process.env.XCSH_HERDR_BINDING_PATH;
		let binding = options?.binding;
		if (!binding && bindingPath) {
			try {
				binding = JSON.parse(await fs.readFile(bindingPath, "utf8")) as HerdrBindingV1;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		binding ??= bindingFromEnvironment();
		if (binding?.version !== 1) throw new HerdrProtocolError("Herdr binding is unavailable", "unavailable");
		const controller = new HerdrController(new HerdrClient(socketPath), bindingPath, binding);
		await controller.claimBinding();
		return controller;
	}

	private async persist(): Promise<void> {
		if (!this.bindingPath) return;
		await fs.mkdir(path.dirname(this.bindingPath), { recursive: true, mode: 0o700 });
		const temporary = `${this.bindingPath}.${process.pid}.tmp`;
		await fs.writeFile(temporary, `${JSON.stringify(this.binding, null, 2)}\n`, { mode: 0o600 });
		await fs.rename(temporary, this.bindingPath);
	}

	private async claimBinding(): Promise<void> {
		await this.client.request("workspace.report_metadata", {
			workspace_id: this.binding.workspaceId,
			source: HERDR_SOURCE,
			tokens: { [HERDR_OWNER_TOKEN]: this.binding.ownerToken },
			seq: Date.now() * 1000,
		});
		await this.client.request("pane.report_metadata", {
			pane_id: this.binding.rootPaneId,
			source: HERDR_SOURCE,
			tokens: { [HERDR_OWNER_TOKEN]: this.binding.ownerToken },
			seq: Date.now() * 1000 + 1,
		});
		await this.persist();
	}

	async updateSessionRef(sessionRef: string | undefined): Promise<void> {
		if (!sessionRef || this.binding.activeSessionRef === sessionRef) return;
		this.binding.activeSessionRef = sessionRef;
		await this.client.request("workspace.report_metadata", {
			workspace_id: this.binding.workspaceId,
			source: HERDR_SOURCE,
			tokens: { [HERDR_OWNER_TOKEN]: this.binding.ownerToken, xcsh_session_ref: sessionRef },
			seq: Date.now() * 1000,
		});
		await this.persist();
	}

	private async ownedPane(paneId: string): Promise<PaneInfo> {
		const result = await this.client.request<{ type: string; pane: PaneInfo }>("pane.get", { pane_id: paneId });
		const pane = result.pane;
		if (
			!pane ||
			pane.workspace_id !== this.binding.workspaceId ||
			pane.tokens?.[HERDR_OWNER_TOKEN] !== this.binding.ownerToken
		) {
			throw new HerdrProtocolError("terminal is not owned by this xcsh conversation", "not_owned");
		}
		return pane;
	}

	async list(): Promise<HerdrTerminalRecordV1[]> {
		const result = await this.client.request<{ type: string; panes: PaneInfo[] }>("pane.list", {
			workspace_id: this.binding.workspaceId,
		});
		const live = new Set(
			(result.panes ?? [])
				.filter(pane => pane.tokens?.[HERDR_OWNER_TOKEN] === this.binding.ownerToken)
				.map(pane => pane.pane_id),
		);
		this.binding.terminals = this.binding.terminals.filter(record => live.has(record.paneId));
		await this.persist();
		return [...this.binding.terminals];
	}

	async create(name: string, cwd?: string): Promise<HerdrTerminalRecordV1> {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(name)) throw new HerdrProtocolError("invalid terminal name");
		if (this.binding.terminals.some(record => record.name === name))
			throw new HerdrProtocolError("terminal name exists");
		const result = await this.client.request<TabCreated>("tab.create", {
			workspace_id: this.binding.workspaceId,
			label: name,
			cwd: cwd ?? process.cwd(),
			focus: false,
			env: { XCSH_HERDR_OWNER: this.binding.ownerToken },
		});
		if (result.type !== "tab_created" || !result.root_pane?.pane_id)
			throw new HerdrProtocolError("invalid tab.create result");
		await this.client.request("pane.report_metadata", {
			pane_id: result.root_pane.pane_id,
			source: HERDR_SOURCE,
			title: name,
			tokens: { [HERDR_OWNER_TOKEN]: this.binding.ownerToken },
			seq: Date.now() * 1000,
		});
		const record = {
			name,
			tabId: result.tab.tab_id,
			paneId: result.root_pane.pane_id,
			createdAt: new Date().toISOString(),
		};
		this.binding.terminals.push(record);
		await this.persist();
		return record;
	}

	private resolve(nameOrId: string): HerdrTerminalRecordV1 {
		const record = this.binding.terminals.find(item => item.name === nameOrId || item.paneId === nameOrId);
		if (!record) throw new HerdrProtocolError("unknown terminal", "not_found");
		return record;
	}

	async run(nameOrId: string, command: string): Promise<void> {
		const record = this.resolve(nameOrId);
		await this.ownedPane(record.paneId);
		this.busyClosePending.delete(record.paneId);
		await this.client.request("pane.send_text", { pane_id: record.paneId, text: command });
		await this.client.request("pane.send_keys", { pane_id: record.paneId, keys: ["enter"] });
		this.lastInputAt.set(record.paneId, Date.now());
	}

	async send(nameOrId: string, text: string, enter = false): Promise<void> {
		const record = this.resolve(nameOrId);
		await this.ownedPane(record.paneId);
		this.busyClosePending.delete(record.paneId);
		await this.client.request("pane.send_text", { pane_id: record.paneId, text });
		if (enter) await this.client.request("pane.send_keys", { pane_id: record.paneId, keys: ["enter"] });
		this.lastInputAt.set(record.paneId, Date.now());
	}

	async read(nameOrId: string, lines = 120): Promise<Record<string, unknown>> {
		const record = this.resolve(nameOrId);
		await this.ownedPane(record.paneId);
		return this.client.request("pane.read", {
			pane_id: record.paneId,
			source: "recent_unwrapped",
			format: "text",
			lines: Math.max(1, Math.min(lines, 1000)),
			strip_ansi: true,
		});
	}

	async wait(nameOrId: string, match: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
		const record = this.resolve(nameOrId);
		await this.ownedPane(record.paneId);
		return this.client.request("pane.wait_for_output", {
			pane_id: record.paneId,
			source: "recent_unwrapped",
			match: { type: "substring", value: match },
			timeout_ms: Math.max(0, Math.min(timeoutMs, 300_000)),
			strip_ansi: true,
		});
	}

	async status(nameOrId: string): Promise<Record<string, unknown>> {
		const record = this.resolve(nameOrId);
		await this.ownedPane(record.paneId);
		return this.client.request("pane.process_info", { pane_id: record.paneId });
	}

	async focus(nameOrId: string): Promise<void> {
		const record = this.resolve(nameOrId);
		await this.ownedPane(record.paneId);
		await this.client.request("pane.focus", { pane_id: record.paneId });
	}

	async close(nameOrId: string, force = false): Promise<void> {
		const record = this.resolve(nameOrId);
		const pane = await this.ownedPane(record.paneId);
		if (pane.tab_id !== record.tabId) {
			throw new HerdrProtocolError("terminal tab identity changed", "not_owned");
		}
		const listed = await this.client.request<{ type: string; panes: PaneInfo[] }>("pane.list", {
			workspace_id: this.binding.workspaceId,
		});
		const tabPanes = (listed.panes ?? []).filter(candidate => candidate.tab_id === pane.tab_id);
		if (
			tabPanes.length === 0 ||
			!tabPanes.some(candidate => candidate.pane_id === record.paneId) ||
			tabPanes.some(candidate => candidate.tokens?.[HERDR_OWNER_TOKEN] !== this.binding.ownerToken)
		) {
			throw new HerdrProtocolError("terminal tab contains an unowned pane", "not_owned");
		}
		const status = await this.client.request<{
			type: string;
			process_info: { shell_pid?: number | null; foreground_processes?: Array<{ pid: number }> };
		}>("pane.process_info", { pane_id: record.paneId });
		const info = status.process_info;
		const recentlySent = Date.now() - (this.lastInputAt.get(record.paneId) ?? 0) < 1_000;
		const busy = recentlySent || (info.foreground_processes ?? []).some(process => process.pid !== info.shell_pid);
		if (busy && (!force || !this.busyClosePending.has(record.paneId))) {
			this.busyClosePending.add(record.paneId);
			throw new HerdrProtocolError("terminal is busy; repeat close with force: true", "busy");
		}
		await this.client.request("tab.close", { tab_id: pane.tab_id });
		this.lastInputAt.delete(record.paneId);
		this.busyClosePending.delete(record.paneId);
		this.binding.terminals = this.binding.terminals.filter(item => item.paneId !== record.paneId);
		await this.persist();
	}
}

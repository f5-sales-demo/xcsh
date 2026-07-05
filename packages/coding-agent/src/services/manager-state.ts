/** Filesystem side of the manager liveness record (`manager.json`), kept next to
 * the control socket so a test's temp socket dir gets its own state file. The
 * record is advisory/observability + the escalation target (pid) when a
 * superseded manager won't release the socket; the control-socket `hello` answer
 * is authoritative. Pure (de)serialization lives in commands/manager-core. */
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { type ManagerState, parseManagerState, serializeManagerState } from "../commands/manager-core";

/** `manager.json` alongside the given control socket. */
export function managerStatePathFor(sockPath: string): string {
	return join(dirname(sockPath), "manager.json");
}

/** Atomically write the liveness record (temp + rename so readers never see a
 * torn file). Best-effort: never throws — a failed write must not crash boot. */
export function writeManagerState(sockPath: string, state: ManagerState): void {
	const p = managerStatePathFor(sockPath);
	try {
		fs.mkdirSync(dirname(p), { recursive: true });
		const tmp = `${p}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, serializeManagerState(state));
		fs.renameSync(tmp, p);
	} catch {
		/* advisory only — the socket is the source of truth */
	}
}

/** Read + validate the record, or null if absent/corrupt. */
export function readManagerState(sockPath: string): ManagerState | null {
	try {
		return parseManagerState(fs.readFileSync(managerStatePathFor(sockPath), "utf8"));
	} catch {
		return null;
	}
}

/** Remove the record on graceful shutdown. Best-effort. */
export function removeManagerState(sockPath: string): void {
	try {
		fs.rmSync(managerStatePathFor(sockPath), { force: true });
	} catch {
		/* best effort */
	}
}

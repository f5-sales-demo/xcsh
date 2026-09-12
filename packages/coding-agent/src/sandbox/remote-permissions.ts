import type { FenceAccess } from "./containment";

export interface RuntimeSandboxSettings {
	get(key: string): unknown;
	override(path: any, value: any): void;
}

export type RemotePermissionProfile =
	| {
			approvalPolicy: "never";
			approvalsReviewer: "user";
			sandboxPolicy: { type: "dangerFullAccess" };
			activePermissionProfile: null;
	  }
	| {
			approvalPolicy: "on-request";
			approvalsReviewer: "user";
			sandboxPolicy: {
				type: "workspaceWrite";
				writableRoots: string[];
				networkAccess: false;
				excludeTmpdirEnvVar: false;
				excludeSlashTmp: false;
			};
			activePermissionProfile: { id: ":workspace" };
	  };

const FULL: RemotePermissionProfile = {
	approvalPolicy: "never",
	approvalsReviewer: "user",
	sandboxPolicy: { type: "dangerFullAccess" },
	activePermissionProfile: null,
};

interface AskState {
	profile: RemotePermissionProfile;
	readGrants: string[];
	writeGrants: string[];
}

const states = new WeakMap<RuntimeSandboxSettings, AskState>();

export function remotePermissionProfile(settings?: RuntimeSandboxSettings): RemotePermissionProfile {
	return settings ? (states.get(settings)?.profile ?? FULL) : FULL;
}

export function initializeRemotePermissionProfile(settings?: RuntimeSandboxSettings): void {
	if (settings && !states.has(settings)) settings.override("sandbox.enabled", false);
}

export function applyRemotePermissionProfile(
	settings: RuntimeSandboxSettings | undefined,
	profile: RemotePermissionProfile,
): void {
	if (!settings) return;
	if (profile.approvalPolicy === "never") {
		states.delete(settings);
		settings.override("sandbox.enabled", false);
		return;
	}
	const state: AskState = { profile, readGrants: [], writeGrants: [...profile.sandboxPolicy.writableRoots] };
	states.set(settings, state);
	settings.override("sandbox.enabled", true);
	settings.override("sandbox.allowRead", []);
	settings.override("sandbox.allowWrite", state.writeGrants);
}

export function isRemoteAsk(settings: RuntimeSandboxSettings): boolean {
	return states.get(settings)?.profile.approvalPolicy === "on-request";
}

export function grantRemoteSandboxPath(settings: RuntimeSandboxSettings, path: string, access: FenceAccess): void {
	const state = states.get(settings);
	if (state?.profile.approvalPolicy !== "on-request") return;
	const target = access === "write" ? state.writeGrants : state.readGrants;
	if (!target.includes(path)) target.push(path);
	settings.override(access === "write" ? "sandbox.allowWrite" : "sandbox.allowRead", [...target]);
}

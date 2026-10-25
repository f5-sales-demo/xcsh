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
			approvalPolicy: "never";
			approvalsReviewer: "user";
			sandboxPolicy: { type: "readOnly"; networkAccess: false };
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

interface RemoteState {
	profile: RemotePermissionProfile;
	readGrants: string[];
	writeGrants: string[];
}

const states = new WeakMap<RuntimeSandboxSettings, RemoteState>();
const owners = new WeakMap<RuntimeSandboxSettings, RuntimeSandboxSettings>();

/** Share live permission state with a session-owned settings facade. */
export function bindRemotePermissionSettings(facade: RuntimeSandboxSettings, owner: RuntimeSandboxSettings): void {
	owners.set(facade, owners.get(owner) ?? owner);
}

function permissionOwner(settings: RuntimeSandboxSettings): RuntimeSandboxSettings {
	return owners.get(settings) ?? settings;
}

export function remotePermissionProfile(settings?: RuntimeSandboxSettings): RemotePermissionProfile {
	return settings ? (states.get(permissionOwner(settings))?.profile ?? FULL) : FULL;
}

export function initializeRemotePermissionProfile(settings?: RuntimeSandboxSettings): void {
	if (settings && !states.has(permissionOwner(settings))) settings.override("sandbox.enabled", false);
}

export function applyRemotePermissionProfile(
	settings: RuntimeSandboxSettings | undefined,
	profile: RemotePermissionProfile,
): void {
	if (!settings) return;
	if (profile.sandboxPolicy.type === "dangerFullAccess") {
		states.delete(permissionOwner(settings));
		settings.override("sandbox.enabled", false);
		return;
	}
	const state: RemoteState = {
		profile,
		readGrants: [],
		writeGrants: profile.sandboxPolicy.type === "workspaceWrite" ? [...profile.sandboxPolicy.writableRoots] : [],
	};
	states.set(permissionOwner(settings), state);
	settings.override("sandbox.enabled", true);
	settings.override("sandbox.allowRead", []);
	settings.override("sandbox.allowWrite", state.writeGrants);
}

export function isRemoteAsk(settings: RuntimeSandboxSettings): boolean {
	return states.get(permissionOwner(settings))?.profile.approvalPolicy === "on-request";
}

export function isRemoteReadOnly(settings: RuntimeSandboxSettings): boolean {
	return states.get(permissionOwner(settings))?.profile.sandboxPolicy.type === "readOnly";
}

export function grantRemoteSandboxPath(settings: RuntimeSandboxSettings, path: string, access: FenceAccess): void {
	const state = states.get(permissionOwner(settings));
	if (state?.profile.approvalPolicy !== "on-request") return;
	const target = access === "write" ? state.writeGrants : state.readGrants;
	if (!target.includes(path)) target.push(path);
	settings.override(access === "write" ? "sandbox.allowWrite" : "sandbox.allowRead", [...target]);
}

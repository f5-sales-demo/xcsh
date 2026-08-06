import type { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import type { Model } from "@f5-sales-demo/pi-ai";

type StoredCredential =
	| { type: "api_key"; key: string }
	| ({ type: "oauth" } & {
			refresh: string;
			access: string;
			expires: number;
			enterpriseUrl?: string;
			projectId?: string;
			tierId?: string;
			email?: string;
			accountId?: string;
	  });

interface EnterpriseOAuthTransactionSession {
	model?: Model;
	thinkingLevel?: ThinkingLevel;
	modelRegistry: {
		authStorage: {
			get(provider: string): StoredCredential | undefined;
			set(provider: string, credential: StoredCredential): Promise<void>;
			remove(provider: string): Promise<void>;
		};
		refresh(mode: "online"): Promise<void>;
	};
	settings: {
		getModelRoles(): Readonly<Record<string, string | undefined>>;
		set(key: "modelRoles", value: Record<string, string>): void;
	};
	setModelTemporary(model: Model, thinkingLevel?: ThinkingLevel): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
}

export interface EnterpriseOAuthLoginSnapshot {
	credential?: StoredCredential;
	model?: Model;
	thinkingLevel?: ThinkingLevel;
	modelRoles: Record<string, string>;
}

const CANONICAL_PROVIDER = "google-antigravity";

export function captureEnterpriseOAuthLoginState(
	session: EnterpriseOAuthTransactionSession,
): EnterpriseOAuthLoginSnapshot {
	const credential = session.modelRegistry.authStorage.get(CANONICAL_PROVIDER);
	const modelRoles = Object.fromEntries(
		Object.entries(session.settings.getModelRoles()).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
	return {
		credential: credential ? { ...credential } : undefined,
		model: session.model,
		thinkingLevel: session.thinkingLevel,
		modelRoles,
	};
}

/** Restore all durable and active state that enterprise login can replace. */
export async function restoreEnterpriseOAuthLoginState(
	session: EnterpriseOAuthTransactionSession,
	snapshot: EnterpriseOAuthLoginSnapshot,
): Promise<void> {
	const rollbackErrors: unknown[] = [];
	try {
		if (snapshot.credential) {
			await session.modelRegistry.authStorage.set(CANONICAL_PROVIDER, snapshot.credential);
		} else {
			await session.modelRegistry.authStorage.remove(CANONICAL_PROVIDER);
		}
	} catch (error) {
		rollbackErrors.push(error);
	}

	try {
		session.settings.set("modelRoles", { ...snapshot.modelRoles });
	} catch (error) {
		rollbackErrors.push(error);
	}

	try {
		await session.modelRegistry.refresh("online");
	} catch (error) {
		rollbackErrors.push(error);
	}

	try {
		if (snapshot.model) {
			await session.setModelTemporary(snapshot.model, snapshot.thinkingLevel);
		} else if (snapshot.thinkingLevel !== undefined) {
			session.setThinkingLevel(snapshot.thinkingLevel);
		}
	} catch (error) {
		rollbackErrors.push(error);
	}

	if (rollbackErrors.length > 0) {
		throw new AggregateError(rollbackErrors, "Enterprise OAuth rollback was incomplete");
	}
}

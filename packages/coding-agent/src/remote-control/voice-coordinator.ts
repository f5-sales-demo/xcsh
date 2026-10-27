import { randomUUID } from "node:crypto";

/** Product identities are kept outside provider request/event schemas. */
export interface VoiceLease {
	readonly chatId: string;
	readonly voiceSessionId: string;
	readonly clientId: string;
	readonly revision: number;
}

/** One audio client per selected chat, including concurrent transport admissions. */
export class VoiceCoordinator {
	#revision = 0;
	#owner?: { lease: VoiceLease; close: () => Promise<void> };
	#tail: Promise<unknown> = Promise.resolve();
	constructor(readonly chatId: string) {}
	get snapshot(): VoiceLease | undefined {
		return this.#owner?.lease;
	}
	acquire(clientId: string, close: () => Promise<void>, takeoverRevision?: number): Promise<VoiceLease> {
		const operation = this.#tail.then(async () => {
			if (!/^[A-Za-z0-9:_-]{1,128}$/.test(clientId)) throw new Error("Invalid audio client identity");
			const previous = this.#owner;
			if (previous) {
				if (takeoverRevision !== previous.lease.revision)
					throw new Error("Explicit takeover of the current audio owner is required");
				await previous.close();
				if (this.#owner && this.#owner !== previous) throw new Error("Audio ownership changed during takeover");
			} else if (takeoverRevision !== undefined) throw new Error("Stale audio takeover revision");
			const lease = Object.freeze({
				chatId: this.chatId,
				voiceSessionId: randomUUID(),
				clientId,
				revision: ++this.#revision,
			});
			this.#owner = { lease, close };
			return lease;
		});
		this.#tail = operation.catch(() => {});
		return operation;
	}
	owns(lease: VoiceLease): boolean {
		return this.#owner?.lease === lease;
	}
	release(lease: VoiceLease): void {
		if (this.owns(lease)) this.#owner = undefined;
	}
}

const coordinators = new WeakMap<object, VoiceCoordinator>();
export function voiceCoordinatorFor(target: object, chatId: string): VoiceCoordinator {
	const existing = coordinators.get(target);
	if (existing?.chatId === chatId) return existing;
	if (existing?.snapshot) throw new Error("The previous chat still owns audio");
	const coordinator = new VoiceCoordinator(chatId);
	coordinators.set(target, coordinator);
	return coordinator;
}

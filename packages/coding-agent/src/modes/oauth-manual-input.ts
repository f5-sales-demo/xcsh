type PendingInput = {
	providerId: string;
	resolve: (value: string) => void;
	reject: (error: Error) => void;
};

export class OAuthManualInputManager {
	#pending?: PendingInput;
	#authorization?: { providerId: string; url: string };

	setAuthorizationUrl(providerId: string, url: string): void {
		this.#authorization = { providerId, url };
	}

	get authorizationUrl(): string | undefined {
		return this.#pending?.providerId === this.#authorization?.providerId ? this.#authorization?.url : undefined;
	}

	clearAuthorizationUrl(providerId: string): void {
		if (this.#authorization?.providerId === providerId) this.#authorization = undefined;
	}

	waitForInput(providerId: string): Promise<string> {
		if (this.#pending) {
			this.clear("Manual OAuth input superseded by a new login");
		}
		if (this.#authorization?.providerId !== providerId) this.#authorization = undefined;

		const { promise, resolve, reject } = Promise.withResolvers<string>();
		this.#pending = { providerId, resolve, reject };
		return promise;
	}

	submit(input: string): boolean {
		if (!this.#pending) return false;
		const { resolve } = this.#pending;
		this.#pending = undefined;
		this.#authorization = undefined;
		resolve(input);
		return true;
	}

	clear(reason = "Manual OAuth input cleared"): void {
		this.#authorization = undefined;
		if (!this.#pending) return;
		const { reject } = this.#pending;
		this.#pending = undefined;
		reject(new Error(reason));
	}

	hasPending(): boolean {
		return Boolean(this.#pending);
	}

	get pendingProviderId(): string | undefined {
		return this.#pending?.providerId;
	}
}

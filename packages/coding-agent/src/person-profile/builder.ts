import { mapToSupportedLocale, setLocale } from "@f5-sales-demo/pi-utils";
import type { MachineProfileService } from "./machine-profile";
import type { PersonProfileService } from "./service";

interface Client {
	allowed(): boolean;
	unavailable(): void;
}

class ProfileCoordinator {
	readonly clients = new Set<Client>();
	#controller?: AbortController;
	#pending?: Promise<void>;
	#timer?: ReturnType<typeof setInterval>;
	constructor(
		private readonly person: PersonProfileService,
		private readonly machine: MachineProfileService,
		private readonly release: () => void,
	) {}
	start(): void {
		if (this.#timer) return;
		void this.refresh();
		this.#timer = setInterval(() => void this.refresh(), 60000);
		this.#timer.unref();
	}
	refresh(): Promise<void> {
		if (![...this.clients].some(client => client.allowed())) {
			this.#controller?.abort();
			return this.#pending ?? Promise.resolve();
		}
		if (this.#pending) return this.#pending;
		const controller = new AbortController();
		this.#controller = controller;
		const allowed = () => [...this.clients].some(client => client.allowed());
		const guard = setInterval(() => {
			if (!allowed()) controller.abort();
		}, 25);
		guard.unref();
		this.#pending = Promise.allSettled([
			this.person.reconcileFromCollectors(controller.signal, 5 * 60000, allowed),
			this.machine.refresh(controller.signal, 24 * 60 * 60000, allowed),
		])
			.then(results => {
				if (results.some(result => result.status === "rejected") && !controller.signal.aborted)
					for (const client of this.clients) client.unavailable();
				const person = results[0];
				if (
					person.status === "fulfilled" &&
					person.value &&
					!controller.signal.aborted &&
					!process.env.XCSH_LOCALE
				) {
					const primary = person.value.facts.preferredLanguage ?? person.value.facts.knowsLanguage?.[0];
					const locale = primary ? mapToSupportedLocale(primary) : undefined;
					if (locale) setLocale(locale);
				}
			})
			.finally(() => {
				clearInterval(guard);
				this.#pending = undefined;
				this.#controller = undefined;
			});
		return this.#pending;
	}
	async detach(client: Client): Promise<void> {
		this.clients.delete(client);
		if (this.clients.size) return;
		clearInterval(this.#timer);
		this.#controller?.abort();
		await this.#pending;
		this.release();
	}
}

const coordinators = new Map<string, ProfileCoordinator>();

/** Session facade over one process-wide coordinator keyed by the canonical profile paths. */
export class ProfileBuilder {
	readonly #client: Client;
	readonly #coordinator: ProfileCoordinator;
	#disposed = false;
	constructor(
		person: PersonProfileService,
		machine: MachineProfileService,
		allowed: () => boolean,
		unavailable: () => void = () => {},
	) {
		const key = `${person.path}\u0000${machine.path}`;
		let coordinator = coordinators.get(key);
		if (!coordinator) {
			coordinator = new ProfileCoordinator(person, machine, () => coordinators.delete(key));
			coordinators.set(key, coordinator);
		}
		this.#coordinator = coordinator;
		this.#client = { allowed: () => !this.#disposed && allowed(), unavailable };
		coordinator.clients.add(this.#client);
	}
	start(): void {
		if (!this.#disposed) this.#coordinator.start();
	}
	refresh(): Promise<void> {
		return this.#disposed ? Promise.resolve() : this.#coordinator.refresh();
	}
	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		await this.#coordinator.detach(this.#client);
	}
}

import { mapToSupportedLocale, setLocale } from "@f5-sales-demo/pi-utils";
import type { MachineProfileService } from "./machine-profile";
import type { PersonProfileService } from "./service";

/** App-owned background discovery. Model tool writes still use the session approval owner. */
export class ProfileBuilder {
	#controller?: AbortController;
	#pending?: Promise<void>;
	#timer?: ReturnType<typeof setInterval>;
	#disposed = false;
	constructor(
		private readonly person: PersonProfileService,
		private readonly machine: MachineProfileService,
		private readonly allowed: () => boolean,
		private readonly unavailable: () => void = () => {},
	) {}
	start(): void {
		if (this.#disposed || this.#timer) return;
		void this.refresh();
		this.#timer = setInterval(() => {
			void this.refresh();
		}, 60000);
		this.#timer.unref();
	}
	refresh(): Promise<void> {
		if (this.#disposed || !this.allowed()) {
			this.#controller?.abort();
			return this.#pending ?? Promise.resolve();
		}
		if (this.#pending) return this.#pending;
		const controller = new AbortController();
		this.#controller = controller;
		// A mode transition invalidates work already running, as does session disposal.
		const guard = setInterval(() => {
			if (!this.allowed()) controller.abort();
		}, 25);
		guard.unref();
		this.#pending = Promise.allSettled([
			this.person.reconcileFromCollectors(controller.signal, 5 * 60000, () => !this.#disposed && this.allowed()),
			this.machine.refresh(controller.signal, 24 * 60 * 60000, () => !this.#disposed && this.allowed()),
		])
			.then(results => {
				if (results.some(result => result.status === "rejected") && !controller.signal.aborted) this.unavailable();
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
	async dispose(): Promise<void> {
		this.#disposed = true;
		clearInterval(this.#timer);
		this.#controller?.abort();
		await this.#pending;
	}
}

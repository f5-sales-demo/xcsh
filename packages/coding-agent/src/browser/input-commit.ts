/**
 * Commit a value into a form control so that a framework which patched the
 * element's `value` descriptor still observes the change.
 *
 * Why this exists: the F5XC console's `vsui-input` (e.g. over the HTTP-LB
 * "Domains" ngx-datatable cell) overrides the native `<input>` `value`
 * descriptor with its own accessor. Typing real keystrokes — or assigning
 * `el.value = …` directly — leaves the text in the DOM but never reaches the
 * Angular reactive-form model, so the form reports the field as still empty.
 *
 * The fix, verified live against the staging console: write through the
 * *prototype's* native value setter (skipping any instance-level patch), then
 * dispatch bubbling `input` and `change` events so the framework's own change
 * detection runs.
 *
 * This module is intentionally dependency-free (DOM only) so it can be both
 * unit-tested (linkedom/fakes) and DRY-injected into the live page via
 * `.toString()` — the same pattern used by dom-context/dt-context.
 */

interface CommittableElement {
	value: string;
	ownerDocument?: { defaultView?: { Event?: typeof Event; KeyboardEvent?: typeof KeyboardEvent } | null } | null;
	dispatchEvent(event: unknown): unknown;
	closest?(selector: string): unknown;
}

export function commitInputValue(el: CommittableElement, value: string): void {
	// Walk the prototype chain (starting ABOVE the instance) for the `value`
	// setter. Starting above the instance is what bypasses a framework's
	// instance-level patch and reaches the real (native) accessor.
	let descriptor: PropertyDescriptor | undefined;
	let proto: object | null = Object.getPrototypeOf(el);
	while (proto) {
		descriptor = Object.getOwnPropertyDescriptor(proto, "value");
		if (descriptor) break;
		proto = Object.getPrototypeOf(proto);
	}
	if (descriptor?.set) descriptor.set.call(el, value);
	else el.value = value;

	const view = el.ownerDocument?.defaultView ?? undefined;
	const EventCtor = view?.Event ?? (typeof Event !== "undefined" ? Event : undefined);
	if (EventCtor) {
		// `input`/`change` cover controls that update on value change; `blur`/
		// `focusout` cover Angular controls configured `updateOn: 'blur'` (the
		// console's vsui-input commits to the model on blur, not on keystroke).
		el.dispatchEvent(new EventCtor("input", { bubbles: true }));
		el.dispatchEvent(new EventCtor("change", { bubbles: true }));
		// ngx-datatable inline-edit cells that persist on Enter (ip-prefix-set
		// "IPv4 Prefix") revert on a bare blur. For inputs inside a datatable,
		// dispatch Enter BEFORE blur so the row commits first; http-lb "Domains"
		// (commits on blur) is unaffected because blur still fires afterwards.
		const KeyCtor = view?.KeyboardEvent ?? (typeof KeyboardEvent !== "undefined" ? KeyboardEvent : undefined);
		const inGrid =
			typeof el.closest === "function" &&
			!!el.closest("ngx-datatable,datatable-body-cell,datatable-body-row,[class*=datatable]");
		if (inGrid && KeyCtor) {
			for (const t of ["keydown", "keypress", "keyup"] as const) {
				el.dispatchEvent(new KeyCtor(t, { bubbles: true, key: "Enter", code: "Enter" }));
			}
		}
		el.dispatchEvent(new EventCtor("blur", { bubbles: false }));
		el.dispatchEvent(new EventCtor("focusout", { bubbles: true }));
	}
}

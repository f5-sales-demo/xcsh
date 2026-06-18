import { describe, expect, it } from "bun:test";
import { parseLocator } from "../../src/browser/selector";

describe("parseLocator", () => {
	it("parses <role>:text('X') as roleName", () => {
		expect(parseLocator("button:text('Add Item')")).toEqual({ kind: "roleName", role: "button", name: "Add Item" });
		expect(parseLocator("tab:text('Add HTTP Load Balancer')")).toEqual({
			kind: "roleName",
			role: "tab",
			name: "Add HTTP Load Balancer",
		});
		expect(parseLocator("option:text('demo')")).toEqual({ kind: "roleName", role: "option", name: "demo" });
	});
	it("parses <role>[name='X'] as roleName", () => {
		expect(parseLocator("textbox[name='Name']")).toEqual({ kind: "roleName", role: "textbox", name: "Name" });
		expect(parseLocator("spinbutton[name='Port']")).toEqual({ kind: "roleName", role: "spinbutton", name: "Port" });
	});
	it("parses text('X') as text", () => {
		expect(parseLocator("text('HTTP Load Balancers')")).toEqual({ kind: "text", text: "HTTP Load Balancers" });
	});
	it("parses a bare known role as role", () => {
		expect(parseLocator("listbox")).toEqual({ kind: "role", role: "listbox" });
		expect(parseLocator("textbox")).toEqual({ kind: "role", role: "textbox" });
	});
	it("falls back to css for everything else", () => {
		expect(parseLocator("[data-testid='resource-name']")).toEqual({
			kind: "css",
			css: "[data-testid='resource-name']",
		});
		expect(parseLocator("input[data-testid='domains-input']")).toEqual({
			kind: "css",
			css: "input[data-testid='domains-input']",
		});
		expect(parseLocator("[data-testid='row-{name}'] [data-testid='row-actions']")).toEqual({
			kind: "css",
			css: "[data-testid='row-{name}'] [data-testid='row-actions']",
		});
	});
});

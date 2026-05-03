import { describe, expect, it } from "bun:test"
import type { CustomToolAPI, ExecResult } from "@f5xc-salesdemos/xcsh"
// Resolve typebox from bun's module store since it's not hoisted to root node_modules
import { Type } from "../../../../node_modules/.bun/@sinclair+typebox@0.34.49/node_modules/@sinclair/typebox/build/esm/index.mjs"

// Minimal StringEnum matching the pi-ai implementation
function StringEnum<const T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
) {
	return Type.Unsafe({
		type: "string",
		enum: values as unknown as string[],
		...(options?.description && { description: options.description }),
		...(options?.default && { default: options.default }),
	})
}

function makePi(execFn: (cmd: string, args: string[]) => ExecResult): CustomToolAPI {
	const pi: Record<string, unknown> = {
		cwd: "/tmp/test",
		exec: async (cmd: string, args: string[]) => execFn(cmd, args),
		hasUI: false,
		logger: console,
		typebox: { Type },
		pi: { StringEnum },
		pushPendingAction: () => {},
		ui: {},
	}
	return pi as unknown as CustomToolAPI
}

function defaultExec(_cmd: string, _args: string[]): ExecResult {
	return { stdout: "", stderr: "not stubbed", code: 1, killed: false }
}

describe("factory", () => {
	it("exports 4 named tools", async () => {
		const { default: factory } = await import("../index")
		const pi = makePi(defaultExec)
		const tools = await factory(pi)
		const arr = Array.isArray(tools) ? tools : [tools]
		expect(arr).toHaveLength(4)
		const names = arr.map(t => t.name).sort()
		expect(names).toEqual(["glab_issue_list", "glab_issue_view", "glab_search", "glab_setup"])
	})
})

describe("glab_setup check action", () => {
	it("returns installed message when glab found", async () => {
		const { default: factory } = await import("../index")
		const pi = makePi((cmd, args) => {
			if (cmd === "which") return { stdout: "/usr/local/bin/glab\n", stderr: "", code: 0, killed: false }
			if (cmd === "glab" && args[0] === "--version") return { stdout: "glab version 1.93.0\n", stderr: "", code: 0, killed: false }
			return defaultExec(cmd, args)
		})
		const tools = await factory(pi)
		const arr = Array.isArray(tools) ? tools : [tools]
		const setup = arr.find(t => t.name === "glab_setup")!
		const result = await setup.execute("id1", { action: "check" }, undefined, {} as any, undefined)
		expect(result.content[0].type).toBe("text")
		expect((result.content[0] as { type: "text"; text: string }).text).toContain("installed")
	})

	it("returns not installed when glab missing", async () => {
		const { default: factory } = await import("../index")
		const pi = makePi((cmd, _args) => {
			if (cmd === "which") return { stdout: "", stderr: "not found", code: 1, killed: false }
			return defaultExec(cmd, _args)
		})
		const tools = await factory(pi)
		const arr = Array.isArray(tools) ? tools : [tools]
		const setup = arr.find(t => t.name === "glab_setup")!
		const result = await setup.execute("id1", { action: "check" }, undefined, {} as any, undefined)
		const text = (result.content[0] as { type: "text"; text: string }).text
		expect(text.toLowerCase()).toContain("not installed")
	})
})

describe("glab_issue_list", () => {
	it("returns no-project message when unconfigured", async () => {
		const { default: factory } = await import("../index")
		const pi = makePi(defaultExec)
		pi.cwd = "/tmp/nonexistent-config-dir"
		const tools = await factory(pi)
		const arr = Array.isArray(tools) ? tools : [tools]
		const listTool = arr.find(t => t.name === "glab_issue_list")!
		const result = await listTool.execute("id1", {}, undefined, {} as any, undefined)
		const text = (result.content[0] as { type: "text"; text: string }).text
		expect(text.toLowerCase()).toContain("no gitlab project configured")
	})

	it("builds correct glab command with explicit project", async () => {
		const { default: factory } = await import("../index")
		const captured: string[][] = []
		const pi = makePi((cmd, args) => {
			if (cmd === "glab") {
				captured.push(args)
				if (args.includes("list") && args.includes("--output")) {
					return { stdout: "[]", stderr: "", code: 0, killed: false }
				}
			}
			return defaultExec(cmd, args)
		})
		const tools = await factory(pi)
		const arr = Array.isArray(tools) ? tools : [tools]
		const listTool = arr.find(t => t.name === "glab_issue_list")!
		await listTool.execute("id1", { project: "group/repo" }, undefined, {} as any, undefined)
		const issueCall = captured.find(a => a.includes("issue") && a.includes("list"))
		expect(issueCall).toBeDefined()
		expect(issueCall).toContain("--repo")
		expect(issueCall).toContain("group/repo")
		expect(issueCall).toContain("--output")
		expect(issueCall).toContain("json")
	})
})

describe("glab_search", () => {
	it("calls REST search with correct params", async () => {
		const { default: factory } = await import("../index")
		const captured: string[][] = []
		const pi = makePi((cmd, args) => {
			if (cmd === "glab") {
				captured.push(args)
				// REST list returns empty
				if (args.includes("list")) return { stdout: "[]", stderr: "", code: 0, killed: false }
				// GraphQL returns empty
				if (args.includes("graphql")) return { stdout: JSON.stringify({ data: { project: { issues: { nodes: [] } } } }), stderr: "", code: 0, killed: false }
			}
			return defaultExec(cmd, args)
		})
		const tools = await factory(pi)
		const arr = Array.isArray(tools) ? tools : [tools]
		const searchTool = arr.find(t => t.name === "glab_search")!
		await searchTool.execute("id1", { query: "Tempus", project: "group/repo" }, undefined, {} as any, undefined)
		const restCall = captured.find(a => a.includes("--search"))
		expect(restCall).toBeDefined()
		expect(restCall).toContain("Tempus")
	})
})

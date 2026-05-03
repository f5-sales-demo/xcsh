import { describe, expect, it } from "bun:test"
import type { CustomToolAPI, ExecResult } from "@f5xc-salesdemos/xcsh"
import type { GraphQLIssueNode } from "../lib/types"
import { buildSearchQuery, executeGraphQL } from "../lib/graphql"

describe("buildSearchQuery", () => {
	it("builds a valid GraphQL query string", () => {
		const query = buildSearchQuery()
		expect(query).toContain("query SearchIssues")
		expect(query).toContain("$projectPath")
		expect(query).toContain("$search")
		expect(query).toContain("$first")
		expect(query).toContain("notes")
		expect(query).toContain("assignees")
	})
})

describe("executeGraphQL", () => {
	function makePi(stdout: string, code = 0): Pick<CustomToolAPI, "exec" | "cwd"> {
		return {
			cwd: "/tmp",
			exec: async () => ({ stdout, stderr: "", code, killed: false }) as ExecResult,
		}
	}

	it("returns parsed nodes on success", async () => {
		const mockNodes: GraphQLIssueNode[] = [
			{
				iid: "42",
				title: "Test issue",
				state: "opened",
				labels: { nodes: [{ title: "bug" }] },
				assignees: { nodes: [{ username: "alice" }] },
				updatedAt: "2024-12-01T00:00:00Z",
				notes: { nodes: [] },
			},
		]
		const mockResponse = { data: { project: { issues: { nodes: mockNodes } } } }
		const pi = makePi(JSON.stringify(mockResponse))
		const result = await executeGraphQL(pi as CustomToolAPI, "group/project", "test query", 10)
		expect(result).toHaveLength(1)
		expect(result[0].title).toBe("Test issue")
	})

	it("returns empty array when project not found", async () => {
		const mockResponse = { data: { project: null } }
		const pi = makePi(JSON.stringify(mockResponse))
		const result = await executeGraphQL(pi as CustomToolAPI, "group/project", "test", 10)
		expect(result).toEqual([])
	})

	it("throws on GraphQL errors array", async () => {
		const mockResponse = { errors: [{ message: "Field 'issues' doesn't exist" }] }
		const pi = makePi(JSON.stringify(mockResponse))
		await expect(executeGraphQL(pi as CustomToolAPI, "group/project", "test", 10)).rejects.toThrow(
			"Field 'issues' doesn't exist",
		)
	})

	it("throws on glab CLI failure", async () => {
		const pi = makePi("", 1)
		await expect(executeGraphQL(pi as CustomToolAPI, "group/project", "test", 10)).rejects.toThrow()
	})
})

import type { CustomToolAPI } from "@f5xc-salesdemos/xcsh"
import { execGlab } from "./exec"
import type { GraphQLIssueNode, GraphQLSearchResponse } from "./types"

export function buildSearchQuery(): string {
	return `
query SearchIssues($projectPath: ID!, $search: String!, $first: Int!) {
  project(fullPath: $projectPath) {
    issues(search: $search, first: $first) {
      nodes {
        iid
        title
        state
        labels { nodes { title } }
        assignees { nodes { username } }
        updatedAt
        notes(first: 20) {
          nodes {
            body
            author { username }
            createdAt
          }
        }
      }
    }
  }
}`.trim()
}

export async function executeGraphQL(
	pi: Pick<CustomToolAPI, "exec" | "cwd">,
	projectPath: string,
	searchText: string,
	limit: number,
	signal?: AbortSignal,
): Promise<GraphQLIssueNode[]> {
	const query = buildSearchQuery()
	const variables = JSON.stringify({ projectPath, search: searchText, first: limit })

	const result = await execGlab(pi, ["api", "graphql", "-f", `query=${query}`, "-f", `variables=${variables}`], signal)

	const response = JSON.parse(result.stdout) as GraphQLSearchResponse

	if (response.errors && response.errors.length > 0) {
		throw new Error(response.errors.map(e => e.message).join("; "))
	}

	return response.data?.project?.issues?.nodes ?? []
}

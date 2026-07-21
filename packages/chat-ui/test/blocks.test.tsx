import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ContentBlockRenderer } from "../src/components/ContentBlockRenderer";
import { ThinkingBlock } from "../src/components/ThinkingBlock";
import { ToolUseContent } from "../src/components/ToolUseContent";

test("ToolUseContent shows the tool name and IN/OUT panels", () => {
	render(<ToolUseContent block={{ type: "tool_use", toolName: "http_request", input: "GET /x", output: "200 OK" }} />);
	expect(screen.getByText("http_request")).toBeDefined();
	expect(screen.getByText("GET /x")).toBeDefined();
	expect(screen.getByText("200 OK")).toBeDefined();
	expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
});

test("ThinkingBlock shows a live label while thinking and a duration once settled", () => {
	const { rerender } = render(<ThinkingBlock thinking="" isCurrentlyThinking={true} />);
	expect(screen.getByText("Thinking…")).toBeDefined();
	rerender(<ThinkingBlock thinking="considered options" isCurrentlyThinking={false} durationMs={3200} />);
	expect(screen.getByText("Thought for 3s")).toBeDefined();
});

test("ContentBlockRenderer renders text as markdown and skips tool_use", () => {
	const { container, rerender } = render(
		<ContentBlockRenderer block={{ type: "text", text: "a **b**" }} isLast busy={false} />,
	);
	expect(container.querySelector("strong")?.textContent).toBe("b");
	rerender(<ContentBlockRenderer block={{ type: "tool_use", toolName: "x" }} isLast busy={false} />);
	expect(container.querySelector("strong")).toBeNull();
});

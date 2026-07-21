import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { F5Logo } from "../src/theme/F5Logo";

test("the ascii variant renders a labelled pre block", () => {
	const { container } = render(<F5Logo variant="ascii" />);
	const logo = screen.getByRole("img", { name: /f5 logo/i });
	expect(logo.tagName).toBe("PRE");
	// tokenized palette classes are present
	expect(container.querySelector(".ascii-red")).not.toBeNull();
	expect(container.querySelector(".ascii-white")).not.toBeNull();
});

test("the mark variant renders the base64 PNG at the requested size", () => {
	render(<F5Logo variant="mark" size={64} />);
	const img = screen.getByRole("img", { name: /f5 logo/i }) as HTMLImageElement;
	expect(img.tagName).toBe("IMG");
	expect(img.getAttribute("src")).toStartWith("data:image/png;base64,");
	expect(img.getAttribute("width")).toBe("64");
});

test("defaults to the ascii variant", () => {
	render(<F5Logo />);
	expect(screen.getByRole("img", { name: /f5 logo/i }).tagName).toBe("PRE");
});

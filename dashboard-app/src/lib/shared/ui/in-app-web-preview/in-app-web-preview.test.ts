import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import InAppWebPreview from "./in-app-web-preview.svelte";

describe("in-app-web-preview", () => {
  it("renders iframe with provided url and shows loader initially", () => {
    const { container, getByText } = render(InAppWebPreview, {
      props: { url: "http://127.0.0.1:8080" },
    });

    expect(getByText("Loading web content...")).toBeInTheDocument();
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("http://127.0.0.1:8080");
  });

  it("updates iframe src when url prop changes", async () => {
    const { container, rerender } = render(InAppWebPreview, {
      props: { url: "http://127.0.0.1:8080" },
    });

    await rerender({ url: "https://example.com" });
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://example.com");
  });

  it("hides loader after iframe load event", async () => {
    const { container, queryByText } = render(InAppWebPreview, {
      props: { url: "http://127.0.0.1:8080" },
    });

    const frame = container.querySelector("iframe");
    frame?.dispatchEvent(new Event("load"));
    await vi.waitFor(() => {
      expect(queryByText("Loading web content...")).not.toBeInTheDocument();
    });
  });
});

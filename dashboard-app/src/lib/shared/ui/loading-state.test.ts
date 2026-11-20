import { render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoadingState from "./loading-state.svelte";
import { loadingElapsedLabel } from "./loading-state";

describe("LoadingState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing extra for a short load, then that it is still running", () => {
    expect(loadingElapsedLabel(0)).toBe("");
    expect(loadingElapsedLabel(2999)).toBe("");
    expect(loadingElapsedLabel(3000)).toBe("still running, 3 s");
    expect(loadingElapsedLabel(12_400)).toBe("still running, 12 s");
  });

  it("is a polite status that names what is loading", () => {
    render(LoadingState, { props: { label: "Scanning cluster resources" } });

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Scanning cluster resources");
  });

  it("shows how long a slow load runs", async () => {
    vi.useFakeTimers();
    render(LoadingState, { props: { label: "Scanning cluster resources" } });

    await vi.advanceTimersByTimeAsync(4000);

    expect(screen.getByRole("status")).toHaveTextContent("still running, 4 s");
  });

  it("keeps the label for screen readers in the skeleton variant", () => {
    render(LoadingState, { props: { label: "Loading pods", variant: "skeleton", rows: 2 } });

    expect(screen.getByRole("status")).toHaveTextContent("Loading pods");
  });
});

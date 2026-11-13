import { fireEvent, render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { reportJsError } = vi.hoisted(() => ({ reportJsError: vi.fn() }));

vi.mock("$app/state", () => ({
  page: { url: new URL("http://localhost/dashboard/clusters/minikube") },
}));

vi.mock("$shared/lib/js-error-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$shared/lib/js-error-log")>();
  return { ...actual, reportJsError };
});

import RenderErrorBoundary from "./render-error-boundary.svelte";

let shouldThrow = true;

const page = createRawSnippet(() => ({
  render: () => {
    if (shouldThrow) throw new TypeError("Cannot read properties of undefined (reading 'name')");
    return "<p>Pods list</p>";
  },
}));

describe("render-error-boundary", () => {
  beforeEach(() => {
    reportJsError.mockClear();
    shouldThrow = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the page when nothing throws", () => {
    shouldThrow = false;
    const { getByText, queryByRole } = render(RenderErrorBoundary, { props: { children: page } });
    expect(getByText("Pods list")).toBeInTheDocument();
    expect(queryByRole("alert")).toBeNull();
    expect(reportJsError).not.toHaveBeenCalled();
  });

  it("shows the error instead of an empty pane and logs it with the route", () => {
    const { getByRole, getByText } = render(RenderErrorBoundary, { props: { children: page } });
    expect(getByRole("alert")).toBeInTheDocument();
    expect(getByText("Something went wrong")).toBeInTheDocument();
    expect(
      getByText("TypeError: Cannot read properties of undefined (reading 'name')"),
    ).toBeInTheDocument();
    expect(reportJsError).toHaveBeenCalledTimes(1);
    expect(reportJsError).toHaveBeenCalledWith(
      "render",
      expect.any(TypeError),
      "/dashboard/clusters/minikube",
    );
  });

  it("Try again re-renders the page once the cause is gone", async () => {
    const { getByRole, findByText, queryByRole } = render(RenderErrorBoundary, {
      props: { children: page },
    });
    shouldThrow = false;
    await fireEvent.click(getByRole("button", { name: "Try again" }));
    expect(await findByText("Pods list")).toBeInTheDocument();
    expect(queryByRole("alert")).toBeNull();
  });
});

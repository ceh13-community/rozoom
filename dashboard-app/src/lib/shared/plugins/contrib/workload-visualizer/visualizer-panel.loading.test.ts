import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlJson: vi.fn(() => new Promise(() => {})),
  kubectlRawArgsFront: vi.fn(() => new Promise(() => {})),
}));

import VisualizerPanel from "./visualizer-panel.svelte";

// Workload Map scanned on its own, but its first frame said "No data yet. Click Refresh
// to scan cluster resources." with no indicator.
describe("Workload Map before the first scan result", () => {
  it("shows the scan from the first frame and never the empty-state text", () => {
    const { getByRole, queryByText } = render(VisualizerPanel, { props: { clusterId: "c1" } });

    expect(getByRole("status")).toHaveTextContent("Scanning cluster resources");
    expect(queryByText(/No data yet/)).toBeNull();
  });
});

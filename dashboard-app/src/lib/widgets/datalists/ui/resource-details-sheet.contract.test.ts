import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/resource-details-sheet.svelte"),
  "utf8",
);

describe("resource details sheet contract", () => {
  it("uses side-panel overlay layout with deployment-style close controls", () => {
    expect(source).toContain("<DetailsSheetPortal");
    expect(source).toContain("<DetailsHeaderActions");
    expect(source).toContain("Close ${getResourceLabel()} details");
  });

  it("renders standard details action controls", () => {
    expect(source).toContain('title: "Logs"');
    expect(source).toContain('title: "Events"');
    expect(source).toContain('title: "Edit YAML"');
    expect(source).toContain('title: "Investigate"');
    expect(source).toContain('title: "Download YAML"');
    expect(source).toContain('title: "Rollout status"');
    expect(source).toContain('title: "Rollout history"');
    expect(source).toContain('title: "Rollout restart"');
    expect(source).toContain('title: "Delete"');
    expect(source).toContain("Open ${getResourceLabel()} logs");
    expect(source).toContain("Open ${getResourceLabel()} events");
    expect(source).toContain("Edit ${getResourceLabel()} YAML");
    expect(source).toContain("Investigate ${getResourceLabel()}");
    expect(source).toContain("Download ${getResourceLabel()} YAML");
    expect(source).toContain("Open rollout status for ${getResourceLabel()}");
    expect(source).toContain("Open rollout history for ${getResourceLabel()}");
    expect(source).toContain("Rollout restart ${getResourceLabel()}");
    expect(source).toContain("Delete ${getResourceLabel()}");
    expect(source).toContain("Close ${getResourceLabel()} details");
    expect(source).toContain('<h3 class="my-4 font-bold">Properties</h3>');
    expect(source).toContain('<h3 class="my-4 font-bold">Pods</h3>');
    expect(source).toContain("No pods found.");
    expect(source).toContain('<h3 class="my-4 font-bold">Events</h3>');
    expect(source).toContain("No events found.");
    expect(source).toContain("inline-flex items-center gap-2 font-medium");
  });

  it("renders workload-specific properties for cron jobs, jobs, replica sets and stateful sets", () => {
    expect(source).toContain('title === "Cron Job"');
    expect(source).toContain('title === "Job"');
    expect(source).toContain('title === "Replica Set"');
    expect(source).toContain('title === "Stateful Set"');
    expect(source).toContain("Job History");
    expect(source).toContain("No jobs found.");
    expect(source).toContain("Schedule");
    expect(source).toContain("Last schedule");
    expect(source).toContain("Next execution");
    expect(source).toContain("Completions");
    expect(source).toContain("Parallelism");
    expect(source).toContain("Pod Anti Affinities");
    expect(source).toContain("Controlled By");
    expect(source).toContain("Pod Status");
  });
});

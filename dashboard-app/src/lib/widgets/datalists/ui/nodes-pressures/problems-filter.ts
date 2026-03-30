import type { FilterFn } from "@tanstack/table-core";
import type { NodesPressuresData } from "./columns";

export const problemsFilter: FilterFn<NodesPressuresData> = (row) => {
  const r = row.original;

  return (
    r.ready !== "True" ||
    r.diskPressure !== "False" ||
    r.memoryPressure !== "False" ||
    r.networkUnavailable !== "False" ||
    r.pidPressure !== "False"
  );
};

import { get, writable } from "svelte/store";

type DashboardRouteActivity = {
  ready: boolean;
  pathname: string | null;
  clusterId: string | null;
  workload: string | null;
  isDashboardRoot: boolean;
};

const DEFAULT_ACTIVITY: DashboardRouteActivity = {
  ready: false,
  pathname: null,
  clusterId: null,
  workload: null,
  isDashboardRoot: false,
};

export const activeDashboardRoute = writable<DashboardRouteActivity>(DEFAULT_ACTIVITY);

function parseClusterId(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/clusters\/([^/]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function setActiveDashboardRoute(pathname: string, search = "") {
  const clusterId = parseClusterId(pathname);
  const searchParams = new URLSearchParams(search);
  const workload = clusterId ? (searchParams.get("workload") ?? "overview") : null;

  activeDashboardRoute.set({
    ready: true,
    pathname,
    clusterId,
    workload,
    isDashboardRoot: pathname === "/dashboard",
  });
}

export function clearActiveDashboardRoute() {
  activeDashboardRoute.set({
    ready: true,
    pathname: null,
    clusterId: null,
    workload: null,
    isDashboardRoot: false,
  });
}

export function isDashboardRootRouteActive() {
  const route = get(activeDashboardRoute);
  if (!route.ready) return true;
  return route.isDashboardRoot;
}

export function isClusterWorkloadRouteActive(clusterId: string, workloads: string | string[]) {
  const route = get(activeDashboardRoute);
  if (!route.ready) return true;
  if (route.clusterId !== clusterId) return false;
  const allowed = Array.isArray(workloads) ? workloads : [workloads];
  return route.workload !== null && allowed.includes(route.workload);
}

export function isDashboardFeatureRouteActive(
  clusterId: string,
  options: { dashboardRoot?: boolean; workloads?: string[] },
) {
  const route = get(activeDashboardRoute);
  if (!route.ready) return true;
  if (options.dashboardRoot && route.isDashboardRoot) return true;
  if (!options.workloads || options.workloads.length === 0) return false;
  return (
    route.clusterId === clusterId &&
    route.workload !== null &&
    options.workloads.includes(route.workload)
  );
}

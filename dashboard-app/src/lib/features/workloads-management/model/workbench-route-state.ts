export type WorkbenchRouteState = {
  resource?: string;
  namespace?: string;
  tab?: "logs" | "yaml" | "events";
  pane?: 1 | 2 | 3;
  compare?: string;
  query?: string;
};

export function encodeWorkbenchRouteState(state: WorkbenchRouteState): string {
  const params = new URLSearchParams();
  if (state.resource) params.set("resource", state.resource);
  if (state.namespace) params.set("ns", state.namespace);
  if (state.tab) params.set("tab", state.tab);
  if (state.pane) params.set("pane", String(state.pane));
  if (state.compare) params.set("compare", state.compare);
  if (state.query) params.set("q", state.query);
  return params.toString();
}

export function decodeWorkbenchRouteState(query: string): WorkbenchRouteState {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const paneRaw = Number(params.get("pane"));
  const pane = paneRaw === 1 || paneRaw === 2 || paneRaw === 3 ? paneRaw : undefined;
  const tabRaw = params.get("tab");
  const tab = tabRaw === "logs" || tabRaw === "yaml" || tabRaw === "events" ? tabRaw : undefined;
  return {
    resource: params.get("resource") ?? undefined,
    namespace: params.get("ns") ?? undefined,
    tab,
    pane,
    compare: params.get("compare") ?? undefined,
    query: params.get("q") ?? undefined,
  };
}

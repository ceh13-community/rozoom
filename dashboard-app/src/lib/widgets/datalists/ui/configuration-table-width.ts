/**
 * Minimum width of the configuration resources table (ConfigMaps, Secrets, quotas,
 * webhooks and the other kinds rendered by configuration-list.svelte).
 *
 * The table uses `table-fixed`: most columns have a fixed px width, and Name, Namespace
 * and Age share whatever is left. With many fixed columns visible (Secrets: Keys, Labels,
 * Type, RV) almost nothing was left, and at a 1280 px window the shared headers shrank to
 * a single letter. Giving the table this minimum width keeps every header readable; a
 * narrower window scrolls the table sideways instead, as on the Deployments page.
 */

/** Fixed column widths in px, as set on the header cells (a contract test keeps them in sync). */
export const CONFIG_FIXED_COLUMN_PX: Readonly<Record<string, number>> = {
  keys: 90,
  labels: 220,
  type: 180,
  handler: 180,
  holder: 180,
  webhooks: 110,
  status: 130,
  minAvailable: 170,
  maxUnavailable: 180,
  currentHealthy: 180,
  desiredHealthy: 180,
  metrics: 100,
  minPods: 100,
  maxPods: 100,
  replicas: 110,
  bindings: 220,
  resource: 180,
  group: 220,
  version: 120,
  scope: 130,
  kind: 120,
  controller: 220,
  apiGroup: 220,
  externalIP: 200,
  selector: 240,
  endpoints: 180,
  ingressClass: 130,
  hosts: 220,
  loadBalancers: 220,
  ingressPorts: 100,
  url: 280,
  policyTypes: 180,
  storageClass: 170,
  size: 110,
  pods: 100,
  capacity: 130,
  serviceType: 140,
  clusterIP: 150,
  ports: 100,
  phase: 120,
  storage: 110,
  claim: 190,
  provisioner: 220,
  reclaimPolicy: 120,
  isDefaultStorageClass: 100,
  resourceVersion: 110,
  value: 120,
  globalDefault: 150,
};

/** Columns sized as a share of the table: their percent and the px they need for the header. */
export const CONFIG_SHARE_COLUMNS: Readonly<Record<string, { percent: number; minPx: number }>> = {
  name: { percent: 28, minPx: 150 },
  namespace: { percent: 18, minPx: 125 },
  createdAt: { percent: 18, minPx: 70 },
};

/** The select checkbox column (w-10) and the actions column (w-20). */
export const CONFIG_LEADING_COLUMNS_PX = 40 + 80;

export function configurationTableMinWidth(visible: Readonly<Record<string, unknown>>): number {
  let fixed = CONFIG_LEADING_COLUMNS_PX;
  for (const [column, px] of Object.entries(CONFIG_FIXED_COLUMN_PX)) {
    if (visible[column]) fixed += px;
  }

  // The share columns split what the fixed columns leave in proportion to their percent.
  // Each needs at least minPx, so the shared part must be at least
  // max(minPx / percent) * (sum of visible percents).
  let percentSum = 0;
  let pxPerPercent = 0;
  for (const [column, { percent, minPx }] of Object.entries(CONFIG_SHARE_COLUMNS)) {
    if (!visible[column]) continue;
    percentSum += percent;
    pxPerPercent = Math.max(pxPerPercent, minPx / percent);
  }

  return Math.ceil(fixed + pxPerPercent * percentSum);
}

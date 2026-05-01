<script lang="ts">
  import { browser } from "$app/environment";
  import "./styles.css";
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Server from "@lucide/svelte/icons/server";
  import Box from "@lucide/svelte/icons/box";
  import Boxes from "@lucide/svelte/icons/boxes";
  import Layers from "@lucide/svelte/icons/layers";
  import Database from "@lucide/svelte/icons/database";
  import Copy from "@lucide/svelte/icons/copy";
  import Briefcase from "@lucide/svelte/icons/briefcase";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Activity from "@lucide/svelte/icons/activity";
  import BarChart3 from "@lucide/svelte/icons/bar-chart-3";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ListCheck from "@lucide/svelte/icons/list-check";
  import Bell from "@lucide/svelte/icons/bell";
  import Gauge from "@lucide/svelte/icons/gauge";
  import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
  import CloudUpload from "@lucide/svelte/icons/cloud-upload";
  import ClipboardCheck from "@lucide/svelte/icons/clipboard-check";
  import Lock from "@lucide/svelte/icons/lock";
  import FileCog from "@lucide/svelte/icons/file-cog";
  import Waypoints from "@lucide/svelte/icons/waypoints";
  import Workflow from "@lucide/svelte/icons/workflow";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";
  import Flag from "@lucide/svelte/icons/flag";
  import Braces from "@lucide/svelte/icons/braces";
  import Handshake from "@lucide/svelte/icons/handshake";
  import Package from "@lucide/svelte/icons/package";
  import LibraryBig from "@lucide/svelte/icons/library-big";
  import SlidersHorizontal from "@lucide/svelte/icons/sliders-horizontal";
  import Blocks from "@lucide/svelte/icons/blocks";
  import KeyRound from "@lucide/svelte/icons/key-round";
  import Archive from "@lucide/svelte/icons/archive";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import History from "@lucide/svelte/icons/history";
  import Bug from "@lucide/svelte/icons/bug";
  import Zap from "@lucide/svelte/icons/zap";
  import AlarmClockCheck from "@lucide/svelte/icons/alarm-clock-check";
  import { menuVisibility, disabledPluginsCount } from "$shared/plugins";

  type MenuItem = {
    key: string;
    href: string;
    label: string;
    title?: string;
    icon?: typeof LayoutDashboard;
    showWhenCollapsed?: boolean;
  };
  type MenuSectionKey =
    | "workloads"
    | "namespace"
    | "configuration"
    | "access_control"
    | "custom_resources"
    | "network"
    | "storage"
    | "cluster_ops"
    | "security_compliance"
    | "observability"
    | "marketplace";
  type MenuSection = {
    key: MenuSectionKey;
    label: string;
    items: MenuItem[];
  };

  interface Props {
    searchParams?: Record<string, string>;
    setSheetOpen?: (open: boolean) => void;
    mobile?: boolean;
    collapsed?: boolean;
  }

  let {
    searchParams = {},
    setSheetOpen = () => {},
    mobile = false,
    collapsed = false,
  }: Props = $props();

  const menuItemClass = $derived.by(() =>
    mobile ? "menu-mobile" : collapsed ? "menu-collapsed" : "menu-desktop",
  );
  const sectionStateStorageKey = "dashboard:cluster-menu:sections:v1";
  const SINGLE_PAGE_NAV_TOOLTIP =
    "Opens as a standalone page. Return to a pinned tab to restore split panes.";

  const overviewItems: MenuItem[] = [
    {
      key: "overview",
      href: "?workload=overview",
      label: "Overview",
      icon: LayoutDashboard,
      showWhenCollapsed: true,
    },
    {
      key: "globaltriage",
      href: "?workload=globaltriage",
      label: "Global Triage",
      title: "Cross-resource problems-first triage across the cluster.",
      icon: TriangleAlert,
      showWhenCollapsed: true,
    },
  ];

  const workloadItems: MenuItem[] = [
    {
      key: "nodesstatus",
      href: "?workload=nodesstatus",
      label: "Nodes status",
      icon: Server,
      showWhenCollapsed: true,
    },
    {
      key: "pods",
      href: "?workload=pods",
      label: "Pods",
      icon: Box,
      showWhenCollapsed: true,
    },
    {
      key: "deployments",
      href: "?workload=deployments",
      label: "Deployments",
      icon: Boxes,
      showWhenCollapsed: true,
    },
    {
      key: "daemonsets",
      href: "?workload=daemonsets",
      label: "Daemon Sets",
      icon: Layers,
      showWhenCollapsed: true,
    },
    {
      key: "statefulsets",
      href: "?workload=statefulsets",
      label: "Stateful Sets",
      icon: Database,
      showWhenCollapsed: true,
    },
    {
      key: "replicasets",
      href: "?workload=replicasets",
      label: "Replica Sets",
      icon: Copy,
      showWhenCollapsed: true,
    },
    {
      key: "replicationcontrollers",
      href: "?workload=replicationcontrollers",
      label: "Replication Controllers",
      icon: Copy,
      showWhenCollapsed: true,
    },
    {
      key: "jobs",
      href: "?workload=jobs",
      label: "Jobs",
      icon: Briefcase,
      showWhenCollapsed: true,
    },
    {
      key: "cronjobs",
      href: "?workload=cronjobs",
      label: "Cron Jobs",
      icon: Clock3,
      showWhenCollapsed: true,
    },
  ];

  const namespaceItems: MenuItem[] = [
    {
      key: "namespaces",
      href: "?workload=namespaces",
      label: "Namespaces",
      title: "Manage namespaces across the selected cluster.",
      icon: Database,
      showWhenCollapsed: true,
    },
  ];

  const clusterOpsItems: MenuItem[] = [
    {
      key: "helm",
      href: "?workload=helm",
      label: "Helm Releases",
      title: "Manage installed Helm releases: upgrade, rollback, uninstall, history.",
      icon: Package,
    },
    {
      key: "helmcatalog",
      href: "?workload=helmcatalog",
      label: "Helm Catalog",
      title: "Curated Helm charts catalog with one-click install to boost cluster score.",
      icon: LibraryBig,
    },
    {
      key: "gitopsbootstrap",
      href: "?workload=gitopsbootstrap",
      label: "GitOps Bootstrap",
      title: "Set up ArgoCD or Flux GitOps for this cluster.",
      icon: GitBranch,
    },
    {
      key: "deprecationscan",
      href: "?workload=deprecationscan",
      label: "API Deprecation Scan",
      title: "Detect deprecated or removed Kubernetes API versions.",
      icon: History,
    },
    {
      key: "versionaudit",
      href: "?workload=versionaudit",
      label: "Version Audit",
      title: "Compare cluster version and Helm chart versions against policy.",
      icon: GitCompareArrows,
    },
    {
      key: "backupaudit",
      href: "?workload=backupaudit",
      label: "Backup Status",
      title:
        "Backup recency and metadata for cluster configuration. Requires Velero or local YAML backup.",
      icon: Archive,
    },
    {
      key: "rotatecerts",
      href: "?workload=rotatecerts",
      label: "Rotate Certificates",
      title: "View and renew control-plane and kubelet TLS certificates.",
      icon: KeyRound,
    },
    {
      key: "visualizer",
      href: "?workload=visualizer",
      label: "Workload Map",
      title:
        "Visual dependency map: Ingress -> Service -> Deployment -> Pod -> Volumes/Secrets/RBAC.",
      icon: Waypoints,
    },
    {
      key: "resourcemap",
      href: "?workload=resourcemap",
      label: "Service Chains",
      title:
        "Linear per-Service chains grouped by namespace: Ingress -> Service -> Workload -> Pod, mounted ConfigMaps/Secrets/PVCs. Choose Workload Map for graph view.",
      icon: Workflow,
    },
  ];

  const configurationItems: MenuItem[] = [
    {
      key: "configmaps",
      href: "?workload=configmaps",
      label: "ConfigMaps",
      title: "Cluster ConfigMaps in current namespace scope.",
      icon: FileCog,
    },
    {
      key: "secrets",
      href: "?workload=secrets",
      label: "Secrets",
      title: "Cluster Secrets in current namespace scope.",
      icon: Lock,
    },
    {
      key: "resourcequotas",
      href: "?workload=resourcequotas",
      label: "Resource Quotas",
      title: "ResourceQuota policies by namespace.",
      icon: Gauge,
    },
    {
      key: "limitranges",
      href: "?workload=limitranges",
      label: "Limit Ranges",
      title: "LimitRange defaults and constraints in namespaces.",
      icon: Layers,
    },
    {
      key: "horizontalpodautoscalers",
      href: "?workload=horizontalpodautoscalers",
      label: "Horizontal Pod Autoscalers",
      title: "HPA targets and replica limits.",
      icon: Waypoints,
    },
    {
      key: "poddisruptionbudgets",
      href: "?workload=poddisruptionbudgets",
      label: "Pod Disruption Budgets",
      title: "PDB settings and allowed disruptions.",
      icon: ShieldAlert,
    },
    {
      key: "priorityclasses",
      href: "?workload=priorityclasses",
      label: "Priority Classes",
      title: "Cluster-wide pod priority classes.",
      icon: Flag,
    },
    {
      key: "runtimeclasses",
      href: "?workload=runtimeclasses",
      label: "Runtime Classes",
      title: "RuntimeClass handlers configured in the cluster.",
      icon: Braces,
    },
    {
      key: "leases",
      href: "?workload=leases",
      label: "Leases",
      title: "Coordination leases used by controllers/components.",
      icon: Handshake,
    },
    {
      key: "mutatingwebhookconfigurations",
      href: "?workload=mutatingwebhookconfigurations",
      label: "Mutating Webhooks",
      title: "MutatingWebhookConfiguration resources.",
      icon: GitCompareArrows,
    },
    {
      key: "validatingwebhookconfigurations",
      href: "?workload=validatingwebhookconfigurations",
      label: "Validating Webhooks",
      title: "ValidatingWebhookConfiguration resources.",
      icon: ClipboardCheck,
    },
  ];
  const networkItems: MenuItem[] = [
    {
      key: "services",
      href: "?workload=services",
      label: "Services",
      title: "Cluster Services in current namespace scope.",
      icon: Boxes,
    },
    {
      key: "endpoints",
      href: "?workload=endpoints",
      label: "Endpoints",
      title: "Resolved backend endpoint addresses for Services.",
      icon: Waypoints,
    },
    {
      key: "endpointslices",
      href: "?workload=endpointslices",
      label: "EndpointSlices",
      title: "Scalable endpoint discovery slices backing Services.",
      icon: Waypoints,
    },
    {
      key: "ingresses",
      href: "?workload=ingresses",
      label: "Ingresses",
      title: "Ingress resources and host/path routing rules.",
      icon: Waypoints,
    },
    {
      key: "ingressclasses",
      href: "?workload=ingressclasses",
      label: "Ingress Classes",
      title: "IngressClass controller mappings and defaults.",
      icon: Braces,
    },
    {
      key: "gatewayclasses",
      href: "?workload=gatewayclasses",
      label: "Gateway Classes",
      title: "GatewayClass resources for Gateway API controllers.",
      icon: Braces,
    },
    {
      key: "gateways",
      href: "?workload=gateways",
      label: "Gateways",
      title: "Gateway API Gateway resources and listeners.",
      icon: Waypoints,
    },
    {
      key: "httproutes",
      href: "?workload=httproutes",
      label: "HTTP Routes",
      title: "Gateway API HTTPRoute resources and routing rules.",
      icon: Waypoints,
    },
    {
      key: "referencegrants",
      href: "?workload=referencegrants",
      label: "Reference Grants",
      title: "Cross-namespace reference grants for Gateway API resources.",
      icon: Handshake,
    },
    {
      key: "portforwarding",
      href: "?workload=portforwarding",
      label: "Port Forwarding",
      title: "Start and manage kubectl port-forward sessions.",
      icon: Activity,
    },
    {
      key: "networkpolicies",
      href: "?workload=networkpolicies",
      label: "Network Policies",
      title: "NetworkPolicy isolation rules by namespace.",
      icon: ShieldAlert,
    },
  ];
  const accessControlItems: MenuItem[] = [
    {
      key: "serviceaccounts",
      href: "?workload=serviceaccounts",
      label: "Service Accounts",
      title: "Namespaced ServiceAccount identities.",
      icon: Lock,
    },
    {
      key: "roles",
      href: "?workload=roles",
      label: "Roles",
      title: "Namespaced RBAC Role resources.",
      icon: Braces,
    },
    {
      key: "rolebindings",
      href: "?workload=rolebindings",
      label: "Role Bindings",
      title: "Namespaced RoleBinding assignments.",
      icon: Handshake,
    },
    {
      key: "clusterroles",
      href: "?workload=clusterroles",
      label: "Cluster Roles",
      title: "Cluster-wide RBAC ClusterRole resources.",
      icon: ShieldCheck,
    },
    {
      key: "clusterrolebindings",
      href: "?workload=clusterrolebindings",
      label: "Cluster Role Bindings",
      title: "Cluster-wide ClusterRoleBinding assignments.",
      icon: ShieldAlert,
    },
    {
      key: "accessreviews",
      href: "?workload=accessreviews",
      label: "Access Reviews",
      title: "Run kubectl auth can-i checks for users and service accounts.",
      icon: ListCheck,
    },
  ];
  const customResourcesItems: MenuItem[] = [
    {
      key: "customresourcedefinitions",
      href: "?workload=customresourcedefinitions",
      label: "Custom Resource Definitions",
      title: "CRD definitions installed in the cluster.",
      icon: FileCog,
    },
  ];
  const storageItems: MenuItem[] = [
    {
      key: "persistentvolumeclaims",
      href: "?workload=persistentvolumeclaims",
      label: "Persistent Volume Claims",
      title: "PVC status and binding information by namespace.",
      icon: Database,
    },
    {
      key: "persistentvolumes",
      href: "?workload=persistentvolumes",
      label: "Persistent Volumes",
      title: "Cluster PersistentVolumes and claim bindings.",
      icon: Database,
    },
    {
      key: "storageclasses",
      href: "?workload=storageclasses",
      label: "Storage Classes",
      title: "Provisioners, reclaim policy, and default StorageClass.",
      icon: FileCog,
    },
    {
      key: "volumeattributesclasses",
      href: "?workload=volumeattributesclasses",
      label: "Volume Attributes Classes",
      title: "CSI volume attribute classes for mutable volume parameters.",
      icon: SlidersHorizontal,
    },
    {
      key: "volumesnapshots",
      href: "?workload=volumesnapshots",
      label: "Volume Snapshots",
      title: "Namespaced volume snapshot resources and readiness.",
      icon: Database,
    },
    {
      key: "volumesnapshotcontents",
      href: "?workload=volumesnapshotcontents",
      label: "Volume Snapshot Contents",
      title: "Cluster snapshot content bindings and deletion policy.",
      icon: Database,
    },
    {
      key: "volumesnapshotclasses",
      href: "?workload=volumesnapshotclasses",
      label: "Volume Snapshot Classes",
      title: "Snapshot drivers, deletion policies, and defaults.",
      icon: FileCog,
    },
    {
      key: "csistoragecapacities",
      href: "?workload=csistoragecapacities",
      label: "CSI Storage Capacities",
      title: "Capacity advertising for CSI topology-aware provisioning.",
      icon: Gauge,
    },
  ];

  const securityComplianceItems: MenuItem[] = [
    {
      key: "securityaudit",
      href: "?workload=securityaudit",
      label: "Security Audit",
      title: "RBAC risk scanner and Pod Security Standards compliance.",
      icon: ShieldAlert,
    },
    {
      key: "authsecurity",
      href: "?workload=authsecurity",
      label: "Auth & Credentials",
      title: "Authentication method, token expiry, and credential storage security.",
      icon: Lock,
    },
    {
      key: "compliancehub",
      href: "?workload=compliancehub",
      label: "Compliance Hub",
      title: "Kubescape and kube-bench status, scans, and findings. Requires Kubescape Operator.",
      icon: ListCheck,
    },
    {
      key: "trivyhub",
      href: "?workload=trivyhub",
      label: "Trivy",
      title:
        "Trivy Operator status and latest vulnerability scan snapshot. Requires Trivy Operator.",
      icon: Bug,
    },
    {
      key: "armorhub",
      href: "?workload=armorhub",
      label: "KubeArmor",
      title: "Runtime protection integration status for KubeArmor. Requires KubeArmor Operator.",
      icon: ShieldCheck,
    },
  ];

  const observabilityItems: MenuItem[] = [
    {
      key: "alertshub",
      href: "?workload=alertshub",
      label: "Cluster Alerts",
      title:
        "Unified alerts feed from Alertmanager, Prometheus, and Events. Falls back to Events when Prometheus is not installed.",
      icon: Bell,
    },
    {
      key: "metricssources",
      href: "?workload=metricssources",
      label: "Metrics Sources Status",
      title: "Availability of kubelet, metrics-server, kube-state-metrics, and node-exporter.",
      icon: Gauge,
    },
    {
      key: "capacityintelligence",
      href: "?workload=capacityintelligence",
      label: "Cost & Efficiency",
      title:
        "Resource efficiency, bin-packing score, cost analysis. Requires metrics-server and kube-state-metrics.",
      icon: BarChart3,
    },
    {
      key: "performanceobs",
      href: "?workload=performanceobs",
      label: "Performance",
      title: "RED metrics, CPU throttling, SLO tracking. Requires Prometheus.",
      icon: Zap,
    },
    {
      key: "nodespressures",
      href: "?workload=nodespressures",
      label: "Nodes Pressures",
      title: "Node readiness and pressure conditions overview.",
      icon: TriangleAlert,
      showWhenCollapsed: true,
    },
    {
      key: "podsrestarts",
      href: "?workload=podsrestarts",
      label: "Pod Restarts",
      title: "Recent pod restarts indicating potential instability.",
      icon: RotateCw,
      showWhenCollapsed: true,
    },
    {
      key: "cronjobshealth",
      href: "?workload=cronjobshealth",
      label: "CronJobs Monitoring",
      title: "CronJob monitoring for missed schedules, failures, or long-running jobs.",
      icon: AlarmClockCheck,
      showWhenCollapsed: true,
    },
  ];

  const marketplaceItems: MenuItem[] = [
    {
      key: "plugins",
      href: "?workload=plugins",
      label: "Plugin Marketplace",
      title: "Extend ROZOOM with pro modules and third-party integrations.",
      icon: Blocks,
    },
  ];
  const sections: MenuSection[] = [
    { key: "workloads", label: "Workloads", items: workloadItems },
    { key: "namespace", label: "Namespace", items: namespaceItems },
    { key: "configuration", label: "Configuration", items: configurationItems },
    { key: "access_control", label: "Access Control", items: accessControlItems },
    { key: "custom_resources", label: "Custom resources", items: customResourcesItems },
    { key: "network", label: "Network", items: networkItems },
    { key: "storage", label: "Storage", items: storageItems },
    { key: "cluster_ops", label: "Cluster Ops", items: clusterOpsItems },
    { key: "security_compliance", label: "Security & Compliance", items: securityComplianceItems },
    { key: "observability", label: "Observability", items: observabilityItems },
    { key: "marketplace", label: "Marketplace", items: marketplaceItems },
  ];
  const defaultSectionState: Record<MenuSectionKey, boolean> = {
    workloads: false,
    namespace: false,
    configuration: false,
    access_control: false,
    custom_resources: false,
    network: false,
    storage: false,
    cluster_ops: false,
    security_compliance: false,
    observability: false,
    marketplace: false,
  };

  function loadSectionState(): Record<MenuSectionKey, boolean> {
    if (!browser) return defaultSectionState;
    try {
      const raw = localStorage.getItem(sectionStateStorageKey);
      if (!raw) return defaultSectionState;
      const parsed = JSON.parse(raw) as Partial<Record<MenuSectionKey, boolean>>;
      return {
        workloads: Boolean(parsed.workloads),
        namespace: Boolean(parsed.namespace),
        configuration: Boolean(parsed.configuration),
        access_control: Boolean(parsed.access_control),
        custom_resources: Boolean(parsed.custom_resources),
        network: Boolean(parsed.network),
        storage: Boolean(parsed.storage),
        cluster_ops: Boolean(parsed.cluster_ops),
        security_compliance: Boolean(parsed.security_compliance),
        observability: Boolean(parsed.observability),
        marketplace: Boolean(parsed.marketplace),
      };
    } catch {
      return defaultSectionState;
    }
  }

  let sectionOpen = $state<Record<MenuSectionKey, boolean>>(loadSectionState());
  let lastAutoOpenedWorkload = $state<string | null>(null);

  $effect(() => {
    if (!browser) return;
    localStorage.setItem(sectionStateStorageKey, JSON.stringify(sectionOpen));
  });

  $effect(() => {
    if (collapsed) return;
    const activeWorkload = searchParams?.workload;
    if (!activeWorkload) return;
    if (lastAutoOpenedWorkload === activeWorkload) return;
    const activeSection = sections.find((section) =>
      section.items.some((item) => item.key === activeWorkload),
    );
    if (!activeSection) return;
    if (!sectionOpen[activeSection.key]) {
      sectionOpen = { ...sectionOpen, [activeSection.key]: true };
    }
    lastAutoOpenedWorkload = activeWorkload;
  });

  // Filter each section's items through the plugin visibility map so that
  // disabling a plugin in the Marketplace reactively hides its pages from
  // the sidebar. Items without an owning plugin are always kept.
  const visibleSections = $derived.by(() => {
    const visibility = $menuVisibility;
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => visibility.get(item.key) !== false),
      }))
      .filter((section) => section.items.length > 0);
  });

  const visibleOverviewItems = $derived.by(() => {
    const visibility = $menuVisibility;
    return overviewItems.filter((item) => visibility.get(item.key) !== false);
  });

  function isActive(key: string) {
    return searchParams?.workload === key;
  }

  function onItemClick() {
    if (mobile) setSheetOpen(false);
  }

  function shouldRender(item: MenuItem) {
    if (!collapsed) return true;
    return Boolean(item.showWhenCollapsed);
  }

  function toggleSection(sectionKey: MenuSectionKey) {
    sectionOpen = {
      ...sectionOpen,
      [sectionKey]: !sectionOpen[sectionKey],
    };
  }

  function withNavigationHint(base?: string) {
    return base ? `${base} ${SINGLE_PAGE_NAV_TOOLTIP}` : SINGLE_PAGE_NAV_TOOLTIP;
  }
</script>

{#each visibleOverviewItems as item}
  {#if shouldRender(item)}
    <a
      href={item.href}
      class={menuItemClass}
      class:active={isActive(item.key)}
      onclick={onItemClick}
      title={withNavigationHint(collapsed ? item.label : item.title)}
      aria-label={item.label}
    >
      {#if item.icon}
        <item.icon class="h-4 w-4 shrink-0" />
      {/if}
      {#if !collapsed}
        {item.label}
      {/if}
    </a>
  {/if}
{/each}

{#if !collapsed}
  <hr class="my-4" />
  {#each visibleSections as section (section.key)}
    <div class="mb-1">
      <button
        type="button"
        class="flex w-full items-center justify-between px-3 py-1 text-xs font-semibold uppercase text-muted-foreground/70"
        onclick={() => toggleSection(section.key)}
      >
        <span>{section.label}</span>
        <ChevronDown
          class="h-4 w-4 transition-transform {sectionOpen[section.key] ? 'rotate-180' : ''}"
        />
      </button>
      {#if sectionOpen[section.key]}
        <div class="mt-1">
          {#each section.items as item (item.key)}
            <a
              href={item.href}
              class={menuItemClass}
              class:active={isActive(item.key)}
              onclick={onItemClick}
              title={withNavigationHint(item.title)}
            >
              <div class="flex items-center gap-2">
                {#if item.icon}
                  <item.icon class="h-4 w-4 shrink-0" />
                {/if}
                <span>{item.label}</span>
                {#if item.key === "plugins" && $disabledPluginsCount > 0}
                  <span
                    class="ml-auto rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-300"
                    title={`${$disabledPluginsCount} plugins disabled - pages hidden from sidebar`}
                  >
                    {$disabledPluginsCount} off
                  </span>
                {/if}
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
{:else}
  {#each visibleSections as section (section.key)}
    {#each section.items as item (item.key)}
      {#if shouldRender(item)}
        <a
          href={item.href}
          class={menuItemClass}
          class:active={isActive(item.key)}
          onclick={onItemClick}
          title={withNavigationHint(item.label)}
          aria-label={item.label}
        >
          {#if item.icon}
            <item.icon class="h-4 w-4 shrink-0" />
          {/if}
        </a>
      {/if}
    {/each}
  {/each}
{/if}

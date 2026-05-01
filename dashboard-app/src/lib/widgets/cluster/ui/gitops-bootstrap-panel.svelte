<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { writable } from "svelte/store";
  import {
    getBootstrapSteps,
    generateArgoCDAppYaml,
    generateFluxGitRepositoryYaml,
    generateFluxKustomizationYaml,
    sanitizeResourceYamlForEdit,
    type GitOpsProvider,
    type GitOpsBootstrapConfig,
  } from "$shared/lib/gitops-bootstrap";
  import { kubectlRawFront, kubectlJson } from "$shared/api/kubectl-proxy";
  import { execCliForCluster } from "$shared/api/cli";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { startPortForward, stopPortForward, activePortForwards } from "$shared/api/port-forward";
  import { openExternalUrl, openInAppUrl } from "$shared/api/in-app-browser";
  import { Button } from "$shared/ui/button";
  import { Badge } from "$shared/ui/badge";
  import * as Card from "$shared/ui/card";
  import * as Table from "$shared/ui/table";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import { CommandConsole, createConsoleSession } from "$shared/ui/command-console";
  import ResourceYamlSheet from "$widgets/datalists/ui/common/resource-yaml-sheet.svelte";
  import {
    confirmWorkbenchTabClose,
    confirmWorkbenchLayoutShrink,
  } from "$widgets/datalists/ui/common/workbench-confirm";
  import { toast } from "svelte-sonner";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  type GitOpsResource = {
    name: string;
    namespace: string;
    syncStatus: string;
    healthStatus: string;
    repoUrl: string;
    path: string;
    revision: string;
    lastSyncedAt: string | null;
    syncMessage: string | null;
    healthMessage: string | null;
  };

  type YamlTab = {
    id: string;
    title: string;
    subtitle: string;
    resourceKey: string;
    yamlText: string;
    originalYaml: string;
    loading: boolean;
    saving: boolean;
    error: string | null;
  };

  let provider = $state<GitOpsProvider>("argocd");
  let repoUrl = $state("");
  let branch = $state("main");
  let path = $state(".");
  let showSteps = $state(false);

  let detecting = $state(false);
  let argoCDInstalled = $state<boolean | null>(null);
  let fluxInstalled = $state<boolean | null>(null);
  let argoCDVersion = $state<string | null>(null);
  let fluxVersion = $state<string | null>(null);

  let resources = $state<GitOpsResource[]>([]);
  let resourcesLoading = $state(false);

  type StepStatus = "idle" | "running" | "ok" | "fail";
  let stepStatus = $state<Record<string, StepStatus>>({});
  let stepOutput = $state<Record<string, string>>({});
  // Top-level shared console: mirrors output from whichever bootstrap
  // step is currently running, so the user sees the same live transcript
  // UX (auto-collapse, dismiss, pulsing dots) that every other install
  // flow in the app uses. Per-step output blocks below keep the
  // granular breakdown.
  const bootstrapSession = createConsoleSession();
  let bootstrapSessionLabel = $state("GitOps bootstrap");
  let stepExpanded = $state<Record<string, boolean>>({});

  // Workbench state
  let yamlTabs = $state<YamlTab[]>([]);
  let activeTabId = $state<string | null>(null);
  let workbenchFullscreen = $state(false);
  let workbenchCollapsed = $state(false);
  let workbenchLayout = $state<"single" | "dual" | "triple">("single");
  let pinnedTabs = $state(new Set<string>());
  let closedTabs = $state<string[]>([]);
  let paneTabIds = $state<[string | null, string | null, string | null]>([null, null, null]);
  let collapsedPaneIndexes = $state<number[]>([]);

  const workbenchTabs = $derived(
    yamlTabs.map((t) => ({ id: t.id, title: t.title, subtitle: t.subtitle })),
  );
  const hasWorkbenchTabs = $derived(workbenchTabs.length > 0);
  const activeTab = $derived(yamlTabs.find((t) => t.id === activeTabId) ?? null);
  const paneIndexes = $derived(
    workbenchLayout === "single" ? [] : workbenchLayout === "dual" ? [0, 1] : [0, 1, 2],
  );

  function getTabForPane(paneIndex: number): YamlTab | null {
    const tabId = paneTabIds[paneIndex];
    return tabId ? (yamlTabs.find((t) => t.id === tabId) ?? null) : null;
  }

  function isPaneCollapsed(paneIndex: number): boolean {
    return !collapsedPaneIndexes.includes(paneIndex);
  }

  function togglePaneCollapsed(paneIndex: number) {
    if (collapsedPaneIndexes.includes(paneIndex)) {
      collapsedPaneIndexes = collapsedPaneIndexes.filter((i) => i !== paneIndex);
    } else {
      collapsedPaneIndexes = [...collapsedPaneIndexes, paneIndex];
    }
  }

  function getPaneClass(paneIndex: number): string {
    if (collapsedPaneIndexes.includes(paneIndex)) return "w-[44px] shrink-0";
    return "flex-1";
  }

  function assignTabToPane(paneIndex: number, tabId: string | null) {
    const next: [string | null, string | null, string | null] = [...paneTabIds];
    next[paneIndex] = tabId;
    if (workbenchLayout === "dual") next[2] = null;
    paneTabIds = next;
    if (tabId) activeTabId = tabId;
    if (!tabId) {
      collapsedPaneIndexes = collapsedPaneIndexes.filter((i) => i !== paneIndex);
    }
  }

  const config = $derived<GitOpsBootstrapConfig>({
    provider,
    repoUrl: repoUrl.trim() || "https://github.com/org/infra.git",
    branch: branch.trim() || "main",
    path: path.trim() || ".",
  });

  const steps = $derived(getBootstrapSteps(config));
  const generatedYaml = $derived.by(() => {
    if (provider === "argocd") return generateArgoCDAppYaml(config);
    return `${generateFluxGitRepositoryYaml(config)}\n---\n${generateFluxKustomizationYaml(config)}`;
  });

  const activeProviderInstalled = $derived(provider === "argocd" ? argoCDInstalled : fluxInstalled);

  function updateTab(tabId: string, updates: Partial<YamlTab>) {
    yamlTabs = yamlTabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t));
  }

  async function detectInstalled() {
    detecting = true;
    try {
      const [argoRes, fluxRes] = await Promise.all([
        kubectlJson<{ items?: Array<{ metadata?: { labels?: Record<string, string> } }> }>(
          "get deployments -n argocd -l app.kubernetes.io/name=argocd-server",
          { clusterId },
        ).catch(() => null),
        kubectlJson<{ items?: Array<{ metadata?: { labels?: Record<string, string> } }> }>(
          "get deployments -n flux-system -l app=helm-controller",
          { clusterId },
        ).catch(() => null),
      ]);

      const argoItems =
        argoRes && typeof argoRes === "object" && Array.isArray(argoRes.items) ? argoRes.items : [];
      argoCDInstalled = argoItems.length > 0;
      argoCDVersion = argoItems[0]?.metadata?.labels?.["app.kubernetes.io/version"] ?? null;

      const fluxItems =
        fluxRes && typeof fluxRes === "object" && Array.isArray(fluxRes.items) ? fluxRes.items : [];
      fluxInstalled = fluxItems.length > 0;
      fluxVersion = fluxItems[0]?.metadata?.labels?.["app.kubernetes.io/version"] ?? null;
    } catch {
      argoCDInstalled = false;
      fluxInstalled = false;
    } finally {
      detecting = false;
    }
  }

  async function loadResources() {
    resourcesLoading = true;
    resources = [];
    try {
      if (provider === "argocd") await loadArgoCDApps();
      else await loadFluxResources();
    } finally {
      resourcesLoading = false;
    }
  }

  async function loadArgoCDApps() {
    const result = await kubectlJson<{
      items?: Array<{
        metadata?: { name?: string; namespace?: string };
        spec?: { source?: { repoURL?: string; path?: string; targetRevision?: string } };
        status?: {
          sync?: { status?: string };
          health?: { status?: string; message?: string };
          reconciledAt?: string;
          operationState?: { finishedAt?: string; message?: string };
          conditions?: Array<{ type?: string; message?: string }>;
        };
      }>;
    }>("get applications.argoproj.io --all-namespaces", { clusterId });
    if (typeof result === "string") return;
    resources = (result.items ?? []).map((item) => {
      const compError = item.status?.conditions?.find((c) => c.type === "ComparisonError");
      const syncMessage = item.status?.operationState?.message ?? compError?.message ?? null;
      return {
        name: item.metadata?.name ?? "unknown",
        namespace: item.metadata?.namespace ?? "argocd",
        syncStatus: item.status?.sync?.status ?? "Unknown",
        healthStatus: item.status?.health?.status ?? "Unknown",
        repoUrl: item.spec?.source?.repoURL ?? "",
        path: item.spec?.source?.path ?? ".",
        revision: item.spec?.source?.targetRevision ?? "HEAD",
        lastSyncedAt: item.status?.operationState?.finishedAt ?? item.status?.reconciledAt ?? null,
        syncMessage,
        healthMessage: item.status?.health?.message ?? null,
      };
    });
  }

  async function loadFluxResources() {
    const result = await kubectlJson<{
      items?: Array<{
        metadata?: { name?: string; namespace?: string };
        spec?: { path?: string; sourceRef?: { name?: string } };
        status?: {
          conditions?: Array<{
            type?: string;
            status?: string;
            reason?: string;
            message?: string;
            lastTransitionTime?: string;
          }>;
          lastAppliedRevision?: string;
        };
      }>;
    }>("get kustomizations.kustomize.toolkit.fluxcd.io --all-namespaces", { clusterId });
    if (typeof result === "string") return;
    resources = (result.items ?? []).map((item) => {
      const ready = item.status?.conditions?.find((c) => c.type === "Ready");
      return {
        name: item.metadata?.name ?? "unknown",
        namespace: item.metadata?.namespace ?? "flux-system",
        syncStatus: ready?.status === "True" ? "Synced" : (ready?.reason ?? "Unknown"),
        healthStatus: ready?.status === "True" ? "Healthy" : "Degraded",
        repoUrl: item.spec?.sourceRef?.name ?? "",
        path: item.spec?.path ?? ".",
        revision: item.status?.lastAppliedRevision ?? "",
        lastSyncedAt: ready?.lastTransitionTime ?? null,
        syncMessage: ready?.status === "True" ? null : (ready?.message ?? null),
        healthMessage: null,
      };
    });
  }

  async function openEditTab(res: GitOpsResource) {
    const tabId = `yaml:${res.namespace}/${res.name}`;
    const existing = yamlTabs.find((t) => t.id === tabId);
    if (existing) {
      activeTabId = tabId;
      workbenchCollapsed = false;
      return;
    }

    const tab: YamlTab = {
      id: tabId,
      title: `YAML ${res.name}`,
      subtitle: res.namespace,
      resourceKey: `${res.namespace}/${res.name}`,
      yamlText: "",
      originalYaml: "",
      loading: true,
      saving: false,
      error: null,
    };
    yamlTabs = [...yamlTabs, tab];
    activeTabId = tabId;
    workbenchCollapsed = false;

    const kind =
      provider === "argocd"
        ? "applications.argoproj.io"
        : "kustomizations.kustomize.toolkit.fluxcd.io";
    const result = await kubectlRawFront(
      `get ${kind} ${res.name} -n ${res.namespace} -o yaml --request-timeout=10s`,
      { clusterId },
    );
    if (result.code === 0 && result.output.trim()) {
      const cleaned = sanitizeResourceYamlForEdit(result.output);
      updateTab(tabId, { yamlText: cleaned, originalYaml: cleaned, loading: false });
    } else {
      updateTab(tabId, { loading: false, error: result.errors || "Failed to fetch YAML" });
    }
  }

  function openCreateTab() {
    const tabId = "yaml:new";
    const existing = yamlTabs.find((t) => t.id === tabId);
    if (existing) {
      updateTab(tabId, { yamlText: generatedYaml, originalYaml: generatedYaml });
      activeTabId = tabId;
      workbenchCollapsed = false;
      return;
    }
    yamlTabs = [
      ...yamlTabs,
      {
        id: tabId,
        title: provider === "argocd" ? "New Application" : "New Kustomization",
        subtitle: "create",
        resourceKey: "new",
        yamlText: generatedYaml,
        originalYaml: generatedYaml,
        loading: false,
        saving: false,
        error: null,
      },
    ];
    activeTabId = tabId;
    workbenchCollapsed = false;
  }

  async function refreshTab(tabId: string) {
    const tab = yamlTabs.find((t) => t.id === tabId);
    if (!tab || tab.resourceKey === "new") {
      updateTab(tabId, { yamlText: generatedYaml, originalYaml: generatedYaml });
      return;
    }
    updateTab(tabId, { loading: true });
    const kind =
      provider === "argocd"
        ? "applications.argoproj.io"
        : "kustomizations.kustomize.toolkit.fluxcd.io";
    const [ns, name] = tab.resourceKey.split("/");
    const result = await kubectlRawFront(
      `get ${kind} ${name} -n ${ns} -o yaml --request-timeout=10s`,
      { clusterId },
    );
    if (result.code === 0 && result.output.trim()) {
      updateTab(tabId, { originalYaml: result.output, loading: false });
      if (tab.yamlText === tab.originalYaml) updateTab(tabId, { yamlText: result.output });
    } else {
      updateTab(tabId, { loading: false });
    }
  }

  type DiffPreview = {
    tabId: string;
    diff: string;
    loading: boolean;
    errorMessage: string | null;
  };
  let diffPreview = $state<DiffPreview | null>(null);

  async function writeTabToTempFile(text: string): Promise<{
    path: string;
    cleanup: () => Promise<void>;
  }> {
    const { writeTextFile, remove } = await import("@tauri-apps/plugin-fs");
    const { appDataDir } = await import("@tauri-apps/api/path");
    const appDir = await appDataDir();
    const path = `${appDir}/gitops-apply-temp-${Math.random().toString(36).slice(2, 8)}.yaml`;
    await writeTextFile(path, text);
    return {
      path,
      cleanup: async () => {
        await remove(path).catch(() => {});
      },
    };
  }

  async function previewApply(tabId: string) {
    const tab = yamlTabs.find((t) => t.id === tabId);
    if (!tab || !tab.yamlText.trim()) return;
    if (tab.resourceKey === "new") {
      void saveTab(tabId);
      return;
    }
    diffPreview = { tabId, diff: "", loading: true, errorMessage: null };
    const temp = await writeTabToTempFile(tab.yamlText);
    try {
      const result = await kubectlRawFront(`diff -f ${temp.path} --request-timeout=15s`, {
        clusterId,
      });
      // kubectl diff: code=0 no changes, code=1 changes present, >1 error
      const code = result.code ?? 0;
      if (code > 1) {
        diffPreview = {
          tabId,
          diff: result.output,
          loading: false,
          errorMessage: result.errors || `kubectl diff exited with code ${code}`,
        };
      } else {
        diffPreview = {
          tabId,
          diff: result.output.trim() || "(no changes - cluster already matches this YAML)",
          loading: false,
          errorMessage: null,
        };
      }
    } finally {
      await temp.cleanup();
    }
  }

  function closeDiffPreview() {
    diffPreview = null;
  }

  async function confirmDiffApply() {
    if (!diffPreview) return;
    const tabId = diffPreview.tabId;
    diffPreview = null;
    await saveTab(tabId);
  }

  async function saveTab(tabId: string) {
    const tab = yamlTabs.find((t) => t.id === tabId);
    if (!tab || !tab.yamlText.trim()) return;
    updateTab(tabId, { saving: true, error: null });
    const temp = await writeTabToTempFile(tab.yamlText);
    try {
      const result = await kubectlRawFront(`apply -f ${temp.path} --request-timeout=30s`, {
        clusterId,
      });
      if (result.code !== 0 || result.errors.length > 0) {
        updateTab(tabId, { error: result.errors || "Apply failed", saving: false });
        toast.error("Apply failed", { description: result.errors.slice(0, 200) });
      } else {
        updateTab(tabId, { originalYaml: tab.yamlText, error: null, saving: false });
        toast.success("Applied", { description: result.output.trim().slice(0, 200) });
        void loadResources();
      }
    } catch (err) {
      updateTab(tabId, { error: err instanceof Error ? err.message : String(err), saving: false });
    } finally {
      await temp.cleanup();
    }
  }

  function setStepStatus(stepId: string, status: StepStatus) {
    stepStatus = { ...stepStatus, [stepId]: status };
    if (status === "ok") bootstrapSession.succeed();
    else if (status === "fail") bootstrapSession.fail();
  }

  function appendStepOutput(stepId: string, chunk: string) {
    const prev = stepOutput[stepId] ?? "";
    stepOutput = { ...stepOutput, [stepId]: prev + chunk };
    bootstrapSession.append(chunk);
  }

  async function waitForDeploymentReady(
    namespace: string,
    deployment: string,
    stepId: string,
    timeoutMs = 180_000,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) {
        appendStepOutput(stepId, "  cancelled\n");
        return false;
      }
      const result = await kubectlJson<{
        status?: { readyReplicas?: number; replicas?: number };
      }>(`get deployment ${deployment} -n ${namespace}`, { clusterId }).catch(() => null);
      if (signal?.aborted) {
        appendStepOutput(stepId, "  cancelled\n");
        return false;
      }
      if (result && typeof result === "object") {
        const ready = result.status?.readyReplicas ?? 0;
        const desired = result.status?.replicas ?? 0;
        appendStepOutput(stepId, `  waiting for ${namespace}/${deployment}: ${ready}/${desired}\n`);
        if (desired > 0 && ready >= desired) return true;
      } else {
        appendStepOutput(stepId, `  deployment ${namespace}/${deployment} not yet created\n`);
      }
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 3000);
        if (signal) {
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }
      }).catch(() => {
        // abort -> fall through to loop head, which re-checks signal
      });
    }
    return false;
  }

  // AbortController per running step so unmount (or user cancel) can stop
  // the waitForDeploymentReady polling. Without this, polling continues
  // after the panel is disposed, keeps calling kubectl, and appends to a
  // disposed step-output map.
  const stepAborts: Record<string, AbortController | null> = {};

  async function runHelmInstall(
    stepId: string,
    repoName: string,
    repoUrl: string,
    installArgs: string[],
    verifyNamespace: string,
    verifyDeployment: string,
  ) {
    const controller = new AbortController();
    stepAborts[stepId] = controller;
    try {
      appendStepOutput(stepId, `$ helm repo add ${repoName} ${repoUrl}\n`);
      const repoAdd = await execCliForCluster(
        "helm",
        ["repo", "add", repoName, repoUrl],
        clusterId,
      );
      appendStepOutput(stepId, (repoAdd.stdout || "") + (repoAdd.stderr || "") + "\n");
      if (controller.signal.aborted) return;
      const alreadyAdded = (repoAdd.stderr || "").toLowerCase().includes("already exists");
      if (repoAdd.code !== 0 && !alreadyAdded) {
        setStepStatus(stepId, "fail");
        return;
      }

      appendStepOutput(stepId, `$ helm repo update\n`);
      const repoUpdate = await execCliForCluster("helm", ["repo", "update"], clusterId);
      appendStepOutput(stepId, (repoUpdate.stdout || "") + (repoUpdate.stderr || "") + "\n");
      if (controller.signal.aborted) return;

      appendStepOutput(stepId, `$ helm ${installArgs.join(" ")}\n`);
      const install = await execCliForCluster("helm", installArgs, clusterId);
      appendStepOutput(stepId, (install.stdout || "") + (install.stderr || "") + "\n");
      if (controller.signal.aborted) return;
      if (install.code !== 0) {
        setStepStatus(stepId, "fail");
        return;
      }

      appendStepOutput(stepId, `\nVerifying ${verifyNamespace}/${verifyDeployment}…\n`);
      const ready = await waitForDeploymentReady(
        verifyNamespace,
        verifyDeployment,
        stepId,
        180_000,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!ready) {
        appendStepOutput(stepId, "Timeout waiting for deployment readiness\n");
        setStepStatus(stepId, "fail");
        return;
      }
      appendStepOutput(stepId, "Deployment is ready.\n");
      setStepStatus(stepId, "ok");
      await detectInstalled();
      void loadResources();
    } finally {
      if (stepAborts[stepId] === controller) {
        stepAborts[stepId] = null;
      }
    }
  }

  async function runStep(stepId: string) {
    if (stepStatus[stepId] === "running") return;
    if (stepId === "argocd-install" || stepId === "flux-install") {
      const name = stepId === "argocd-install" ? "Argo CD" : "Flux";
      const ns = stepId === "argocd-install" ? "argocd" : "flux-system";
      const confirmed = await confirmAction(
        `Install ${name} into namespace "${ns}" on this cluster?\n\n` +
          `This will add a Helm repo, create the namespace if missing, and deploy ${name} ` +
          "with cluster-wide permissions. The operation can take several minutes.\n\n" +
          "Run only on clusters where you intend to manage GitOps.",
        `Install ${name}`,
      );
      if (!confirmed) return;
    }
    bootstrapSessionLabel =
      stepId === "argocd-install"
        ? "Installing Argo CD"
        : stepId === "flux-install"
          ? "Installing Flux"
          : `Running ${stepId}`;
    bootstrapSession.start();
    setStepStatus(stepId, "running");
    stepOutput = { ...stepOutput, [stepId]: "" };
    stepExpanded = { ...stepExpanded, [stepId]: true };
    try {
      if (stepId === "argocd-install") {
        await runHelmInstall(
          stepId,
          "argo",
          "https://argoproj.github.io/argo-helm",
          [
            "upgrade",
            "--install",
            "argocd",
            "argo/argo-cd",
            "--namespace",
            "argocd",
            "--create-namespace",
            "--wait",
            "--timeout",
            "5m",
          ],
          "argocd",
          "argocd-server",
        );
      } else if (stepId === "flux-install") {
        await runHelmInstall(
          stepId,
          "fluxcd-community",
          "https://fluxcd-community.github.io/helm-charts",
          [
            "upgrade",
            "--install",
            "flux",
            "fluxcd-community/flux2",
            "--namespace",
            "flux-system",
            "--create-namespace",
            "--wait",
            "--timeout",
            "5m",
          ],
          "flux-system",
          "helm-controller",
        );
      } else {
        setStepStatus(stepId, "fail");
        appendStepOutput(stepId, `Unknown step: ${stepId}\n`);
      }
    } catch (err) {
      appendStepOutput(stepId, `Error: ${err instanceof Error ? err.message : String(err)}\n`);
      setStepStatus(stepId, "fail");
    }
  }

  function stepButtonLabel(stepId: string): string {
    const status = stepStatus[stepId] ?? "idle";
    if (status === "running") return "Running…";
    if (status === "ok") return "Re-run";
    if (status === "fail") return "Retry";
    return "Run";
  }

  function removeTab(tabId: string) {
    closedTabs = [...closedTabs, tabId];
    yamlTabs = yamlTabs.filter((t) => t.id !== tabId);
    pinnedTabs.delete(tabId);
    paneTabIds = paneTabIds.map((id) => (id === tabId ? null : id)) as [
      string | null,
      string | null,
      string | null,
    ];
    if (activeTabId === tabId) activeTabId = yamlTabs[0]?.id ?? null;
    if (yamlTabs.length === 0) {
      workbenchCollapsed = true;
      workbenchFullscreen = false;
    }
  }

  async function closeTab(tabId: string) {
    const tab = yamlTabs.find((t) => t.id === tabId);
    if (!tab) return;
    const wbTab = workbenchTabs.find((t) => t.id === tabId);
    if (wbTab) {
      try {
        const confirmed = await confirmWorkbenchTabClose({
          kind: "yaml",
          title: wbTab.title,
          subtitle: wbTab.subtitle,
        });
        if (!confirmed) return;
      } catch {
        // If confirm dialog fails, proceed with close.
      }
    }
    removeTab(tabId);
  }

  function reopenLastClosed() {
    // simplified
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (workbenchFullscreen) {
      workbenchFullscreen = false;
    }
  }

  function toggleCollapse() {
    workbenchCollapsed = !workbenchCollapsed;
    if (workbenchCollapsed && workbenchFullscreen) workbenchFullscreen = false;
  }

  function toggleFullscreen() {
    workbenchFullscreen = !workbenchFullscreen;
    if (workbenchFullscreen) workbenchCollapsed = false;
  }

  async function setWorkbenchLayout(layout: "single" | "dual" | "triple") {
    const currentPaneCount = workbenchLayout === "single" ? 1 : workbenchLayout === "dual" ? 2 : 3;
    const nextPaneCount = layout === "single" ? 1 : layout === "dual" ? 2 : 3;
    if (nextPaneCount < currentPaneCount && currentPaneCount > 1) {
      const confirmed = await confirmWorkbenchLayoutShrink();
      if (!confirmed) return;
    }
    workbenchLayout = layout;
    if (layout === "single") {
      paneTabIds = [null, null, null];
      collapsedPaneIndexes = [];
      return;
    }
    const ids = workbenchTabs.map((t) => t.id);
    const used = new Set<string>();
    const next: [string | null, string | null, string | null] = [...paneTabIds];
    for (let idx = 0; idx < 3; idx++) {
      if (next[idx] && !ids.includes(next[idx]!)) next[idx] = null;
      if (next[idx]) used.add(next[idx]!);
    }
    if (!next[0] && activeTabId) {
      next[0] = activeTabId;
      used.add(activeTabId);
    }
    const paneCount = layout === "dual" ? 2 : 3;
    for (let idx = 0; idx < paneCount; idx++) {
      if (next[idx]) continue;
      const candidate = ids.find((id) => !used.has(id)) ?? null;
      next[idx] = candidate;
      if (candidate) used.add(candidate);
    }
    if (layout === "dual") next[2] = null;
    paneTabIds = next;
    collapsedPaneIndexes = collapsedPaneIndexes.filter((i) => i < paneCount);
  }

  async function deleteResource(res: GitOpsResource) {
    const kindLabel = provider === "argocd" ? "Application" : "Kustomization";
    const confirmed = await confirmAction(
      `Delete ${kindLabel} "${res.name}" in namespace "${res.namespace}"?\n\n` +
        "If prune is enabled, all workloads managed by this resource (deployments, services, " +
        "configmaps, secrets) will be removed from the cluster.\n\n" +
        "This cannot be undone.",
      `Delete ${kindLabel}`,
    );
    if (!confirmed) return;
    const kind =
      provider === "argocd"
        ? "applications.argoproj.io"
        : "kustomizations.kustomize.toolkit.fluxcd.io";
    const result = await kubectlRawFront(
      `delete ${kind} ${res.name} -n ${res.namespace} --request-timeout=10s`,
      { clusterId },
    );
    if (result.code === 0) {
      toast.success(`Deleted ${res.name}`);
      closeTab(`yaml:${res.namespace}/${res.name}`);
      void loadResources();
    } else {
      toast.error("Delete failed", { description: result.errors });
    }
  }

  let expandedMessageKey = $state<string | null>(null);
  let syncingKey = $state<string | null>(null);
  let testingRepo = $state(false);
  let repoTestResult = $state<{ ok: boolean; message: string } | null>(null);

  async function testRepoAccess() {
    const url = repoUrl.trim();
    if (!url) {
      repoTestResult = { ok: false, message: "Enter a Git Repository URL first." };
      return;
    }
    testingRepo = true;
    repoTestResult = null;
    try {
      if (url.startsWith("git@") || url.startsWith("ssh://")) {
        repoTestResult = {
          ok: true,
          message:
            "SSH URL format is valid. Actual access requires the cluster to have your SSH key as a Secret (configured in ArgoCD/Flux settings, not here).",
        };
        return;
      }
      if (!url.startsWith("https://") && !url.startsWith("http://")) {
        repoTestResult = {
          ok: false,
          message: "URL must start with https://, http://, git@, or ssh://",
        };
        return;
      }
      const probeUrl = url.replace(/\.git$/, "") + "/info/refs?service=git-upload-pack";
      const result = await execCliForCluster(
        "curl",
        ["-sI", "--max-time", "6", "-o", "/dev/null", "-w", "%{http_code}", probeUrl],
        clusterId,
      );
      const code = result.stdout.trim();
      if (code === "200") {
        repoTestResult = { ok: true, message: `Public repo reachable (HTTP ${code}).` };
      } else if (code === "401" || code === "403") {
        repoTestResult = {
          ok: true,
          message:
            `Repo exists but requires authentication (HTTP ${code}). Configure credentials Secret in ` +
            `${provider === "argocd" ? "ArgoCD" : "Flux"} before creating the Application.`,
        };
      } else if (code === "404") {
        repoTestResult = {
          ok: false,
          message: "Repo not found (HTTP 404). Check the URL — typo or wrong organization?",
        };
      } else if (!code) {
        repoTestResult = {
          ok: false,
          message: `Could not reach host. ${result.stderr.trim().slice(0, 160)}`,
        };
      } else {
        repoTestResult = { ok: false, message: `Unexpected response: HTTP ${code}` };
      }
    } finally {
      testingRepo = false;
    }
  }

  let openingArgoUI = $state(false);

  const ARGOCD_PF_LOCAL_PORT = 18080;
  const ARGOCD_PF_KEY = $derived(
    `${clusterId}:argocd:svc/argocd-server:${ARGOCD_PF_LOCAL_PORT}:443`,
  );

  async function detectArgoCDInsecureMode(): Promise<boolean> {
    const result = await kubectlJson<{ data?: { "server.insecure"?: string } }>(
      "get configmap argocd-cmd-params-cm -n argocd",
      { clusterId },
    ).catch(() => null);
    const value =
      result && typeof result === "object" ? result.data?.["server.insecure"] : undefined;
    return typeof value === "string" && value.toLowerCase() === "true";
  }

  async function ensureArgoCDPortForward(): Promise<{ ok: boolean; passwordHint: string }> {
    const existing = $activePortForwards[ARGOCD_PF_KEY];
    if (!existing || !existing.isRunning) {
      const result = await startPortForward({
        namespace: "argocd",
        resource: "svc/argocd-server",
        remotePort: 443,
        localPort: ARGOCD_PF_LOCAL_PORT,
        clusterId,
        uniqueKey: ARGOCD_PF_KEY,
      });
      if (!result.success) {
        toast.error("Port-forward failed", {
          description: result.error?.slice(0, 200) ?? "Unknown error",
        });
        return { ok: false, passwordHint: "" };
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    const secretResult = await kubectlJson<{ data?: { password?: string } }>(
      "get secret argocd-initial-admin-secret -n argocd",
      { clusterId },
    ).catch(() => null);
    let passwordHint = "See argocd-initial-admin-secret";
    if (secretResult && typeof secretResult === "object" && secretResult.data?.password) {
      try {
        passwordHint = atob(secretResult.data.password);
      } catch {
        // ignore decode errors
      }
    }
    try {
      await navigator.clipboard.writeText(passwordHint);
    } catch {
      // ignore clipboard failure
    }
    return { ok: true, passwordHint };
  }

  async function resolveArgoCDUrl(): Promise<string> {
    const insecure = await detectArgoCDInsecureMode();
    const scheme = insecure ? "http" : "https";
    return `${scheme}://localhost:${ARGOCD_PF_LOCAL_PORT}`;
  }

  async function openArgoCDUIExternal() {
    if (!argoCDInstalled) {
      toast.error("ArgoCD is not installed on this cluster");
      return;
    }
    openingArgoUI = true;
    try {
      const { ok, passwordHint } = await ensureArgoCDPortForward();
      if (!ok) return;
      const url = await resolveArgoCDUrl();
      toast.success("ArgoCD UI → opening in your system browser", {
        description:
          `login: admin / ${passwordHint}  (also copied to clipboard)\n\n` +
          (url.startsWith("https")
            ? `Your browser will warn about a self-signed TLS certificate - ` +
              `Chrome: "Advanced → Proceed"; Firefox: "Accept the risk". Expected on localhost.`
            : `ArgoCD is configured in insecure mode - using plain HTTP.`),
        duration: 20_000,
      });
      await openExternalUrl(url);
    } finally {
      openingArgoUI = false;
    }
  }

  async function openArgoCDUIInApp() {
    if (!argoCDInstalled) {
      toast.error("ArgoCD is not installed on this cluster");
      return;
    }
    openingArgoUI = true;
    try {
      const { ok, passwordHint } = await ensureArgoCDPortForward();
      if (!ok) return;
      const url = await resolveArgoCDUrl();
      toast.success("ArgoCD UI → opening in app window", {
        description:
          `login: admin / ${passwordHint}  (also copied to clipboard)\n\n` +
          (url.startsWith("https")
            ? `If the in-app browser cannot complete the TLS handshake (common with cloud ArgoCD behind ingress), use "External browser".`
            : `ArgoCD is in insecure mode - plain HTTP is being used.`),
        duration: 20_000,
      });
      await openInAppUrl(url);
    } finally {
      openingArgoUI = false;
    }
  }

  async function stopArgoCDPortForward() {
    const uniqueKey = `${clusterId}:argocd:svc/argocd-server:18080:443`;
    if ($activePortForwards[uniqueKey]?.isRunning) {
      await stopPortForward(uniqueKey);
      toast.success("ArgoCD port-forward stopped");
    }
  }

  async function syncArgoCDApp(res: GitOpsResource) {
    const key = `${res.namespace}/${res.name}`;
    syncingKey = key;
    try {
      // ArgoCD Application sync is triggered by setting `.operation.sync` on
      // the MAIN resource, not the status subresource - the controller polls
      // .operation and acts on it. Patching --subresource status silently
      // lands on `.status.operation`, which the controller ignores, so the
      // click produced no sync in production even though the call returned 0.
      const patch = JSON.stringify({
        operation: {
          sync: { revision: "HEAD", prune: false, syncOptions: ["CreateNamespace=true"] },
        },
      });
      const result = await kubectlRawFront(
        `patch application.argoproj.io ${res.name} -n ${res.namespace} --type merge ` +
          `-p ${JSON.stringify(patch)} --request-timeout=10s`,
        { clusterId },
      );
      if (result.code === 0) {
        toast.success(`Sync triggered for ${res.name}`);
        setTimeout(() => void loadResources(), 1500);
      } else {
        toast.error("Sync failed", { description: result.errors.slice(0, 200) });
      }
    } finally {
      syncingKey = null;
    }
  }

  function formatRelativeTime(iso: string | null): string {
    if (!iso) return "-";
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return "-";
    const diffMs = Date.now() - ts;
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  function resourceMessage(res: GitOpsResource): string | null {
    if (res.syncStatus === "OutOfSync" || res.syncStatus === "Unknown") {
      return res.syncMessage || "Resource is out of sync with Git. Click Sync to reconcile.";
    }
    if (res.healthStatus === "Degraded" || res.healthStatus === "Missing") {
      return (
        res.healthMessage || "Resource is unhealthy - check workloads in the target namespace."
      );
    }
    return res.syncMessage || res.healthMessage;
  }

  function syncBadgeClass(s: string): string {
    return s === "Synced"
      ? "bg-emerald-600 text-white"
      : s === "OutOfSync"
        ? "bg-amber-500 text-black"
        : "bg-slate-500 text-white";
  }
  function healthBadgeClass(s: string): string {
    if (s === "Healthy") return "bg-emerald-600 text-white";
    if (s === "Degraded" || s === "Missing") return "bg-rose-600 text-white";
    if (s === "Progressing" || s === "Suspended") return "bg-amber-500 text-black";
    return "bg-slate-500 text-white";
  }

  onMount(async () => {
    await detectInstalled();
    if (argoCDInstalled || fluxInstalled) {
      if (fluxInstalled && !argoCDInstalled) provider = "flux";
      void loadResources();
    }
  });

  onDestroy(() => {
    for (const key of Object.keys(stepAborts)) {
      stepAborts[key]?.abort();
      stepAborts[key] = null;
    }
  });

  $effect(() => {
    const nextYaml = generatedYaml;
    untrack(() => {
      const newTab = yamlTabs.find((t) => t.id === "yaml:new");
      if (!newTab) return;
      if (newTab.yamlText === newTab.originalYaml && newTab.yamlText === nextYaml) return;
      if (newTab.yamlText !== newTab.originalYaml) return;
      updateTab("yaml:new", { yamlText: nextYaml, originalYaml: nextYaml });
    });
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <button
        class="rounded px-2.5 py-1 text-xs font-medium border transition {provider === 'argocd'
          ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
          : 'border-border text-muted-foreground hover:border-foreground/30'}"
        onclick={() => {
          provider = "argocd";
          if (argoCDInstalled) void loadResources();
        }}
        title="ArgoCD - pull-based GitOps with a built-in web UI. Uses Application CRDs to sync Git repos to namespaces. Best for teams wanting a visual dashboard."
      >
        ArgoCD {#if argoCDInstalled}<Badge class="ml-1 bg-emerald-600 text-white text-[9px]"
            >{argoCDVersion ?? "ok"}</Badge
          >{:else if argoCDInstalled === false}<span class="ml-1 text-[9px] text-muted-foreground"
            >not found</span
          >{/if}
      </button>
      <button
        class="rounded px-2.5 py-1 text-xs font-medium border transition {provider === 'flux'
          ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400'
          : 'border-border text-muted-foreground hover:border-foreground/30'}"
        onclick={() => {
          provider = "flux";
          if (fluxInstalled) void loadResources();
        }}
        title="Flux CD - pull-based GitOps, CLI/CRD-first, no built-in UI. Uses GitRepository + Kustomization/HelmRelease CRDs. Best for teams that live in kubectl."
      >
        Flux {#if fluxInstalled}<Badge class="ml-1 bg-emerald-600 text-white text-[9px]"
            >{fluxVersion ?? "ok"}</Badge
          >{:else if fluxInstalled === false}<span class="ml-1 text-[9px] text-muted-foreground"
            >not found</span
          >{/if}
      </button>
    </div>
    <div class="flex items-center gap-2">
      {#if argoCDInstalled && provider === "argocd"}
        {@const isForwarded = $activePortForwards[ARGOCD_PF_KEY]?.isRunning === true}
        <div class="inline-flex items-center rounded border border-border">
          <Button
            variant="ghost"
            size="sm"
            class="rounded-r-none border-r border-border"
            disabled={openingArgoUI}
            onclick={() => void openArgoCDUIInApp()}
            title="Ensure port-forward, then open ArgoCD UI in the app's built-in browser window (may reject self-signed TLS)"
          >
            {#if openingArgoUI}<LoadingDots />{:else}ArgoCD UI: In-app{/if}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="rounded-l-none"
            disabled={openingArgoUI}
            onclick={() => void openArgoCDUIExternal()}
            title="Ensure port-forward, then open ArgoCD UI in your system default browser (can bypass self-signed TLS warning)"
          >
            {#if openingArgoUI}<LoadingDots />{:else}External{/if}
          </Button>
        </div>
        {#if isForwarded}
          <Button
            variant="ghost"
            size="sm"
            onclick={() => void stopArgoCDPortForward()}
            title="Stop the port-forward to argocd-server"
          >
            Stop forward
          </Button>
        {/if}
      {/if}
      <Button variant="outline" size="sm" onclick={openCreateTab}>+ New</Button>
      <Button variant="ghost" size="sm" disabled={detecting} onclick={detectInstalled}>
        {#if detecting}<LoadingDots />{:else}Refresh{/if}
      </Button>
    </div>
  </div>

  <CommandConsole session={bootstrapSession} label={bootstrapSessionLabel} />

  <!-- Create config inputs -->
  {#if activeTabId === "yaml:new"}
    <div class="space-y-2">
      <div class="grid grid-cols-[1fr_auto_120px_120px] gap-2 items-end">
        <div>
          <label class="text-[10px] text-muted-foreground block mb-0.5" for="gitops-repo"
            >Git Repository URL</label
          >
          <input
            id="gitops-repo"
            type="text"
            bind:value={repoUrl}
            onchange={() => {
              repoTestResult = null;
            }}
            placeholder="https://github.com/org/infra.git"
            class="w-full h-7 text-xs px-2 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={testingRepo || !repoUrl.trim()}
          onclick={() => void testRepoAccess()}
          title="Probe the Git URL via HTTPS (public repos return 200, private return 401/403)"
        >
          {#if testingRepo}<LoadingDots />{:else}Test access{/if}
        </Button>
        <div>
          <label class="text-[10px] text-muted-foreground block mb-0.5" for="gitops-branch"
            >Branch</label
          >
          <input
            id="gitops-branch"
            type="text"
            bind:value={branch}
            placeholder="main"
            class="w-full h-7 text-xs px-2 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
        <div>
          <label class="text-[10px] text-muted-foreground block mb-0.5" for="gitops-path"
            >Path</label
          >
          <input
            id="gitops-path"
            type="text"
            bind:value={path}
            placeholder="."
            class="w-full h-7 text-xs px-2 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
      </div>
      {#if repoTestResult}
        <div
          class={`rounded border px-2 py-1.5 text-[11px] ${
            repoTestResult.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/40 bg-rose-500/10 text-rose-300"
          }`}
        >
          <span class="font-semibold">{repoTestResult.ok ? "✓" : "✗"}</span>
          {repoTestResult.message}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Workbench ABOVE table -->
  {#if hasWorkbenchTabs}
    <MultiPaneWorkbench
      tabs={workbenchTabs}
      {activeTabId}
      isTabPinned={(id) => pinnedTabs.has(id)}
      onActivateTab={(id) => (activeTabId = id)}
      onTogglePin={(id) => {
        const next = new Set(pinnedTabs);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        pinnedTabs = next;
      }}
      onCloseTab={closeTab}
      onReopenLastClosedTab={reopenLastClosed}
      reopenDisabled={closedTabs.length === 0}
      layout={workbenchLayout}
      onLayoutChange={(l) => setWorkbenchLayout(l)}
      fullscreen={workbenchFullscreen}
      onToggleFullscreen={toggleFullscreen}
      collapsed={workbenchCollapsed}
      onToggleCollapse={toggleCollapse}
    >
      {#snippet body()}
        {#if !workbenchCollapsed && activeTab}
          <div
            class={workbenchFullscreen ? "min-h-0 flex-1" : "h-[min(70dvh,760px)] min-h-[430px]"}
          >
            {#if workbenchLayout === "single"}
              <ResourceYamlSheet
                embedded={true}
                isOpen={writable(true)}
                podRef={activeTab.resourceKey === "new" ? activeTab.title : activeTab.resourceKey}
                originalYaml={activeTab.originalYaml}
                yamlText={activeTab.yamlText}
                loading={activeTab.loading}
                saving={activeTab.saving}
                hasChanges={activeTab.yamlText !== activeTab.originalYaml}
                error={activeTab.error}
                showBreadcrumb={false}
                onYamlChange={(v) => updateTab(activeTab.id, { yamlText: v })}
                onRefresh={() => refreshTab(activeTab.id)}
                onSave={() => void previewApply(activeTab.id)}
              />
            {:else}
              <div class="flex h-full gap-2 p-2">
                {#each paneIndexes as paneIndex}
                  {@const paneTab = getTabForPane(paneIndex)}
                  <div
                    class="{getPaneClass(
                      paneIndex,
                    )} min-h-0 flex flex-col overflow-hidden rounded border"
                  >
                    <div class="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
                      <span class="text-muted-foreground">Pane {paneIndex + 1}</span>
                      <select
                        class="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={paneTabIds[paneIndex] ?? ""}
                        onchange={(event) => {
                          const value = event.currentTarget.value;
                          assignTabToPane(paneIndex, value || null);
                        }}
                      >
                        <option value="">Select tab</option>
                        {#each workbenchTabs as tab}
                          <option value={tab.id}>
                            {tab.title} · {tab.subtitle}
                          </option>
                        {/each}
                      </select>
                    </div>
                    <div class="min-h-0 flex-1 overflow-hidden">
                      {#if paneTab && isPaneCollapsed(paneIndex)}
                        <ResourceYamlSheet
                          embedded={true}
                          isOpen={writable(true)}
                          podRef={paneTab.resourceKey === "new"
                            ? paneTab.title
                            : paneTab.resourceKey}
                          originalYaml={paneTab.originalYaml}
                          yamlText={paneTab.yamlText}
                          loading={paneTab.loading}
                          saving={paneTab.saving}
                          hasChanges={paneTab.yamlText !== paneTab.originalYaml}
                          error={paneTab.error}
                          canVerticalCollapse={true}
                          showBreadcrumb={false}
                          onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                          onYamlChange={(v) => updateTab(paneTab.id, { yamlText: v })}
                          onRefresh={() => refreshTab(paneTab.id)}
                          onSave={() => void previewApply(paneTab.id)}
                        />
                      {:else if paneTab}
                        <ResourceYamlSheet
                          embedded={true}
                          isOpen={writable(true)}
                          podRef={paneTab.resourceKey === "new"
                            ? paneTab.title
                            : paneTab.resourceKey}
                          originalYaml={paneTab.originalYaml}
                          yamlText={paneTab.yamlText}
                          loading={paneTab.loading}
                          saving={paneTab.saving}
                          hasChanges={paneTab.yamlText !== paneTab.originalYaml}
                          error={paneTab.error}
                          isVerticallyCollapsed
                          canVerticalCollapse={true}
                          showBreadcrumb={false}
                          onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                          onYamlChange={(v) => updateTab(paneTab.id, { yamlText: v })}
                          onRefresh={() => refreshTab(paneTab.id)}
                          onSave={() => void previewApply(paneTab.id)}
                        />
                      {:else}
                        <div
                          class="flex h-full items-center justify-center p-4 text-sm text-muted-foreground"
                        >
                          Select tab for pane {paneIndex + 1}
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/snippet}
    </MultiPaneWorkbench>
  {/if}

  <!-- Not installed - guided 3-step wizard -->
  {#if activeProviderInstalled === false && !hasWorkbenchTabs}
    {@const installStep = steps[0]}
    {@const installStatus = installStep ? (stepStatus[installStep.id] ?? "idle") : "idle"}
    {@const installDone = installStatus === "ok"}
    {@const gitDone = repoTestResult?.ok === true && repoUrl.trim().length > 0}
    <Card.Root>
      <Card.Content class="py-6">
        <div class="space-y-4">
          <div class="space-y-1 text-center">
            <p class="text-sm font-medium">Get started with GitOps on this cluster</p>
            <p class="text-xs text-muted-foreground">
              Three steps: install the controller, verify your Git repo, create your first sync.
              Each step unlocks the next.
            </p>
          </div>

          <!-- Step 1: Install -->
          {#if installStep}
            {@const stepNum = 1}
            <div class="flex items-start gap-3">
              <div
                class={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  installStatus === "ok"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : installStatus === "fail"
                      ? "bg-rose-500/20 text-rose-400"
                      : installStatus === "running"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-indigo-500/20 text-indigo-400"
                }`}
              >
                {installStatus === "ok" ? "✓" : installStatus === "fail" ? "✗" : stepNum}
              </div>
              <div class="min-w-0 flex-1 rounded border border-border bg-muted/30 p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium">{installStep.label}</div>
                    <div class="text-[11px] text-muted-foreground">
                      Deploys the {provider === "argocd" ? "ArgoCD" : "Flux"} controller into the
                      {provider === "argocd" ? "argocd" : "flux-system"} namespace via Helm, then waits
                      for readiness.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={installDone ? "outline" : "default"}
                    disabled={installStatus === "running"}
                    onclick={() => void runStep(installStep.id)}
                  >
                    {#if installStatus === "running"}<LoadingDots />{/if}
                    {stepButtonLabel(installStep.id)}
                  </Button>
                </div>
                <code class="mt-2 block text-[10px] text-muted-foreground font-mono"
                  >{installStep.command.join(" ")}</code
                >
                {#if stepOutput[installStep.id]}
                  <button
                    type="button"
                    class="mt-1 text-[10px] text-sky-400 hover:underline"
                    onclick={() => {
                      stepExpanded = {
                        ...stepExpanded,
                        [installStep.id]: !stepExpanded[installStep.id],
                      };
                    }}
                  >
                    {stepExpanded[installStep.id] ? "Hide output" : "Show output"}
                  </button>
                  {#if stepExpanded[installStep.id]}
                    <pre
                      class="mt-1 max-h-40 overflow-auto rounded bg-slate-950/70 p-2 text-[10px] font-mono text-slate-300 whitespace-pre-wrap">{stepOutput[
                        installStep.id
                      ]}</pre>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}

          <!-- Step 2: Verify Git repo -->
          <div class="flex items-start gap-3" class:opacity-60={!installDone}>
            <div
              class={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                gitDone
                  ? "bg-emerald-500/20 text-emerald-400"
                  : installDone
                    ? "bg-indigo-500/20 text-indigo-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {gitDone ? "✓" : 2}
            </div>
            <div class="min-w-0 flex-1 rounded border border-border bg-muted/30 p-3">
              <div class="text-sm font-medium">Point to your Git repo</div>
              <div class="text-[11px] text-muted-foreground">
                Enter your manifests repo URL and verify access. Public repos work out of the box;
                private ones need a credentials Secret (configure in {provider === "argocd"
                  ? "ArgoCD Settings → Repositories"
                  : "Flux GitRepository secretRef"}).
              </div>
              <div class="mt-2 flex gap-2">
                <input
                  type="text"
                  bind:value={repoUrl}
                  onchange={() => {
                    repoTestResult = null;
                  }}
                  disabled={!installDone}
                  placeholder="https://github.com/org/infra.git"
                  class="flex-1 h-7 text-xs px-2 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground/50 disabled:opacity-50"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!installDone || testingRepo || !repoUrl.trim()}
                  onclick={() => void testRepoAccess()}
                >
                  {#if testingRepo}<LoadingDots />{:else}Test access{/if}
                </Button>
              </div>
              {#if repoTestResult}
                <div
                  class={`mt-2 rounded border px-2 py-1.5 text-[11px] ${
                    repoTestResult.ok
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                  }`}
                >
                  <span class="font-semibold">{repoTestResult.ok ? "✓" : "✗"}</span>
                  {repoTestResult.message}
                </div>
              {/if}
            </div>
          </div>

          <!-- Step 3: Create resource -->
          <div class="flex items-start gap-3" class:opacity-60={!gitDone}>
            <div
              class={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                gitDone ? "bg-indigo-500/20 text-indigo-400" : "bg-muted text-muted-foreground"
              }`}
            >
              3
            </div>
            <div class="min-w-0 flex-1 rounded border border-border bg-muted/30 p-3">
              <div class="text-sm font-medium">
                Create your first {provider === "argocd" ? "Application" : "Kustomization"}
              </div>
              <div class="text-[11px] text-muted-foreground">
                Opens a YAML draft pre-filled with the repo URL above. Edit branch/path in the
                editor, then click Apply - changes show as a diff before execution.
              </div>
              <div class="mt-2">
                <Button size="sm" disabled={!gitDone} onclick={openCreateTab}>
                  Open draft YAML
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Resource table BELOW workbench -->
  {#if activeProviderInstalled && resources.length > 0}
    <TableSurface>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Name</Table.Head>
            <Table.Head>Namespace</Table.Head>
            <Table.Head>Sync</Table.Head>
            <Table.Head>Health</Table.Head>
            <Table.Head>Last synced</Table.Head>
            <Table.Head>Repo / Source</Table.Head>
            <Table.Head class="text-right">Actions</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each resources as res (res.namespace + "/" + res.name)}
            {@const rowKey = `${res.namespace}/${res.name}`}
            {@const message = resourceMessage(res)}
            {@const hasMessage = Boolean(message)}
            <Table.Row
              class={activeTabId === `yaml:${res.namespace}/${res.name}` ? "bg-sky-500/5" : ""}
            >
              <Table.Cell class="font-mono text-xs">{res.name}</Table.Cell>
              <Table.Cell class="text-xs">{res.namespace}</Table.Cell>
              <Table.Cell>
                <button
                  type="button"
                  class="inline-flex items-center"
                  disabled={!hasMessage}
                  title={hasMessage ? "Click to see details" : res.syncStatus}
                  onclick={() => {
                    if (!hasMessage) return;
                    expandedMessageKey = expandedMessageKey === rowKey ? null : rowKey;
                  }}
                >
                  <Badge class="{syncBadgeClass(res.syncStatus)} text-[10px]">
                    {res.syncStatus}{hasMessage ? " ⓘ" : ""}
                  </Badge>
                </button>
              </Table.Cell>
              <Table.Cell>
                <Badge class="{healthBadgeClass(res.healthStatus)} text-[10px]">
                  {res.healthStatus}
                </Badge>
              </Table.Cell>
              <Table.Cell
                class="text-xs text-muted-foreground"
                title={res.lastSyncedAt ?? "never synced"}
              >
                {formatRelativeTime(res.lastSyncedAt)}
              </Table.Cell>
              <Table.Cell
                class="text-xs text-muted-foreground max-w-[200px] truncate"
                title={res.repoUrl}>{res.repoUrl || res.path}</Table.Cell
              >
              <Table.Cell class="text-right">
                <div class="flex items-center justify-end gap-1">
                  {#if provider === "argocd"}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => void syncArgoCDApp(res)}
                      disabled={syncingKey === rowKey}
                      title="Trigger manual sync (kubectl patch)"
                    >
                      {syncingKey === rowKey ? "Syncing…" : "Sync"}
                    </Button>
                  {/if}
                  <Button variant="ghost" size="sm" onclick={() => openEditTab(res)}
                    >Edit YAML</Button
                  >
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-rose-500 hover:text-rose-400"
                    onclick={() => deleteResource(res)}>Delete</Button
                  >
                </div>
              </Table.Cell>
            </Table.Row>
            {#if expandedMessageKey === rowKey && hasMessage}
              <Table.Row>
                <Table.Cell colspan={7} class="bg-muted/30 text-xs">
                  <div class="flex items-start gap-2 px-2 py-2">
                    <span
                      class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold"
                      >!</span
                    >
                    <pre class="whitespace-pre-wrap text-xs text-muted-foreground">{message}</pre>
                  </div>
                </Table.Cell>
              </Table.Row>
            {/if}
          {/each}
        </Table.Body>
      </Table.Root>
    </TableSurface>
  {:else if activeProviderInstalled && !resourcesLoading}
    <Card.Root>
      <Card.Content class="py-6">
        <div class="space-y-3 text-center">
          <p class="text-sm font-medium">
            {provider === "argocd" ? "ArgoCD is running" : "Flux is running"}, but no
            {provider === "argocd" ? "Applications" : "Kustomizations"} exist yet
          </p>
          <p class="mx-auto max-w-md text-xs text-muted-foreground">
            An {provider === "argocd" ? "Application" : "Kustomization"} tells the controller
            <em>which Git repo and path to sync</em> into <em>which namespace</em>. You can point it
            at a public sample repo to test, or at your own manifests.
          </p>
          <div class="flex items-center justify-center gap-2">
            <Button size="sm" onclick={openCreateTab}>
              Create first {provider === "argocd" ? "Application" : "Kustomization"}
            </Button>
            <Button size="sm" variant="outline" onclick={() => void loadResources()}>
              Refresh
            </Button>
          </div>
        </div>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

{#if diffPreview}
  <button
    type="button"
    class="fixed inset-0 z-[150] bg-black/40"
    aria-label="Close diff preview"
    onclick={closeDiffPreview}
  ></button>
  <div
    class="fixed inset-y-6 right-6 z-[160] flex w-[min(70vw,800px)] flex-col rounded-lg border bg-background shadow-2xl"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div>
        <div class="text-sm font-semibold">Preview changes before apply</div>
        <div class="text-[11px] text-muted-foreground">
          Output of <code>kubectl diff -f &lt;your-yaml&gt;</code> against the live cluster.
        </div>
      </div>
      <Button variant="ghost" size="sm" onclick={closeDiffPreview}>Close</Button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto p-4">
      {#if diffPreview.loading}
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <LoadingDots /> Computing diff…
        </div>
      {:else if diffPreview.errorMessage}
        <div
          class="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
        >
          {diffPreview.errorMessage}
        </div>
        {#if diffPreview.diff}
          <pre
            class="mt-2 whitespace-pre-wrap rounded bg-slate-950/70 p-3 text-[11px] font-mono text-slate-300">{diffPreview.diff}</pre>
        {/if}
      {:else}
        <pre
          class="whitespace-pre-wrap rounded bg-slate-950/70 p-3 text-[11px] font-mono text-slate-300">{diffPreview.diff}</pre>
      {/if}
    </div>
    <div class="flex items-center justify-end gap-2 border-t px-4 py-3">
      <Button variant="outline" size="sm" onclick={closeDiffPreview}>Cancel</Button>
      <Button
        size="sm"
        class="bg-emerald-600 text-white hover:bg-emerald-700"
        disabled={diffPreview.loading}
        onclick={() => void confirmDiffApply()}
      >
        Apply anyway
      </Button>
    </div>
  </div>
{/if}

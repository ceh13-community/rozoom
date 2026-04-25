<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    EditorState,
    StateField,
    StateEffect,
    Compartment,
    type Extension,
  } from "@codemirror/state";
  import {
    EditorView,
    Decoration,
    type DecorationSet,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    rectangularSelection,
    crosshairCursor,
    scrollPastEnd,
    ViewUpdate,
    hoverTooltip,
    type Tooltip,
  } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { yaml } from "@codemirror/lang-yaml";
  import {
    syntaxHighlighting,
    indentOnInput,
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentUnit,
    HighlightStyle,
  } from "@codemirror/language";
  import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
  import {
    autocompletion,
    completionKeymap,
    type CompletionContext,
    type CompletionResult,
  } from "@codemirror/autocomplete";
  import {
    linter,
    lintGutter,
    lintKeymap,
    openLintPanel,
    closeLintPanel,
    type Diagnostic,
  } from "@codemirror/lint";
  import { tags } from "@lezer/highlight";
  import { load as parseYaml, YAMLException } from "js-yaml";
  import {
    validateYamlSyntax,
    detectDuplicateKeys,
    checkIndentation,
    parseKubeconformOutput,
    kubeconformToDiagnostics,
  } from "./yaml-lint";
  import {
    getYamlPathAtOffset,
    formatYamlPath,
    formatYamlPathDot,
    type PathSegment,
  } from "./yaml-path";
  import { parseYamlDocuments, getDocumentAtOffset, type YamlDocumentInfo } from "./yaml-documents";
  import { getFieldDoc, extractFieldAtPosition } from "./yaml-k8s-schema";
  import { execCli } from "$shared/api/cli";
  import { writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
  import { appDataDir } from "@tauri-apps/api/path";

  interface Props {
    value: string;
    readonly?: boolean;
    onChange?: (value: string) => void;
    onSave?: () => void;
    onPathChange?: (segments: PathSegment[]) => void;
    onDocumentsChange?: (docs: YamlDocumentInfo[], activeIndex: number) => void;
    errorLines?: number[];
    diffLines?: number[];
  }

  const {
    value,
    readonly = false,
    onChange,
    onSave,
    onPathChange,
    onDocumentsChange,
    errorLines = [],
    diffLines = [],
  }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let view: EditorView | undefined;
  let viewReady = $state(false);
  let skipNextUpdate = false;
  const readonlyCompartment = new Compartment();

  const setHighlightedLines = StateEffect.define<{ errorLines: number[]; diffLines: number[] }>();

  const errorLineDeco = Decoration.line({ class: "cm-line-error" });
  const diffLineDeco = Decoration.line({ class: "cm-line-diff" });

  const highlightedLinesField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(decos, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setHighlightedLines)) {
          const builder: any[] = [];
          const doc = tr.state.doc;
          for (const lineNo of effect.value.errorLines) {
            if (lineNo >= 1 && lineNo <= doc.lines) {
              builder.push(errorLineDeco.range(doc.line(lineNo).from));
            }
          }
          for (const lineNo of effect.value.diffLines) {
            if (lineNo >= 1 && lineNo <= doc.lines) {
              builder.push(diffLineDeco.range(doc.line(lineNo).from));
            }
          }
          builder.sort((a: any, b: any) => a.from - b.from);
          return Decoration.set(builder);
        }
      }
      return decos;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const rozoomHighlight = HighlightStyle.define([
    { tag: tags.propertyName, color: "#7dd3fc" }, // sky-300 - YAML keys
    { tag: tags.string, color: "#fde68a" }, // amber-200 - string values
    { tag: tags.number, color: "#c4b5fd" }, // violet-300 - numbers
    { tag: tags.bool, color: "#f9a8d4" }, // pink-300 - booleans
    { tag: tags.null, color: "#94a3b8" }, // slate-400 - null
    { tag: tags.comment, color: "#6ee7b7" }, // emerald-300 - comments
    { tag: tags.keyword, color: "#93c5fd" }, // blue-300 - keywords
    { tag: tags.operator, color: "#cbd5e1" }, // slate-300 - operators
    { tag: tags.punctuation, color: "#94a3b8" }, // slate-400 - punctuation
    { tag: tags.meta, color: "#94a3b8" }, // slate-400 - directives
  ]);

  const rozoomTheme = EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "12px",
      backgroundColor: "#020617", // slate-950
    },
    ".cm-content": {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: "12px 0",
      caretColor: "#e2e8f0",
    },
    ".cm-cursor": {
      borderLeftColor: "#e2e8f0",
    },
    ".cm-gutters": {
      backgroundColor: "#0f172a80", // slate-900/50
      borderRight: "1px solid #1e293b", // slate-800
      color: "#64748b", // slate-500
      minWidth: "48px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#1e293b60", // slate-800/40
      color: "#94a3b8", // slate-400
    },
    ".cm-activeLine": {
      backgroundColor: "#1e293b40", // slate-800/25
    },
    ".cm-selectionBackground": {
      backgroundColor: "#334155 !important", // slate-700
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "#334155 !important",
    },
    ".cm-searchMatch": {
      backgroundColor: "#fbbf2440", // amber-400/25
      outline: "1px solid #fbbf2460",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#fbbf2460",
    },
    ".cm-foldGutter .cm-gutterElement": {
      cursor: "pointer",
      color: "#64748b",
      fontSize: "11px",
    },
    ".cm-foldGutter .cm-gutterElement:hover": {
      color: "#e2e8f0",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "#1e293b",
      border: "1px solid #334155",
      color: "#64748b",
      padding: "0 4px",
      borderRadius: "3px",
      margin: "0 2px",
    },
    ".cm-tooltip": {
      backgroundColor: "#1e293b",
      border: "1px solid #334155",
      color: "#e2e8f0",
    },
    ".cm-tooltip-autocomplete": {
      "& > ul > li": {
        padding: "2px 8px",
      },
      "& > ul > li[aria-selected]": {
        backgroundColor: "#334155",
        color: "#e2e8f0",
      },
    },
    ".cm-tooltip-hover": {
      backgroundColor: "#1e293b",
      border: "1px solid #334155",
      color: "#e2e8f0",
      borderRadius: "6px",
      padding: "0",
      maxWidth: "400px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    },
    ".cm-panels": {
      backgroundColor: "#0f172a",
      borderTop: "1px solid #1e293b",
      color: "#e2e8f0",
    },
    ".cm-panel.cm-search": {
      backgroundColor: "#0f172a",
      "& input": {
        backgroundColor: "#1e293b",
        border: "1px solid #334155",
        color: "#e2e8f0",
        borderRadius: "4px",
        padding: "2px 6px",
      },
      "& button": {
        backgroundColor: "#1e293b",
        border: "1px solid #334155",
        color: "#e2e8f0",
        borderRadius: "4px",
        padding: "2px 8px",
      },
      "& label": {
        color: "#94a3b8",
      },
    },
    ".cm-panel.cm-panel-lint": {
      backgroundColor: "#0f172a",
      borderTop: "1px solid #1e293b",
      maxHeight: "150px",
      "& ul": {
        "& [aria-selected]": {
          backgroundColor: "#1e293b",
        },
      },
    },
    ".cm-line-error": {
      backgroundColor: "#ef444433",
    },
    ".cm-line-diff": {
      backgroundColor: "#0ea5e920",
    },
    ".cm-lint-marker": {
      width: "8px",
      padding: "0 2px",
    },
    ".cm-lint-marker-error": {
      content: "'!'",
    },
    ".cm-lint-marker-warning": {
      content: "'!'",
    },
    ".cm-diagnostic-error": {
      borderLeft: "3px solid #ef4444",
      paddingLeft: "8px",
    },
    ".cm-diagnostic-warning": {
      borderLeft: "3px solid #f59e0b",
      paddingLeft: "8px",
    },
    ".cm-diagnostic-info": {
      borderLeft: "3px solid #3b82f6",
      paddingLeft: "8px",
    },
  });

  const K8S_TOP_LEVEL = [
    { label: "apiVersion", type: "property", detail: "API version", boost: 10 },
    { label: "kind", type: "property", detail: "Resource type", boost: 10 },
    { label: "metadata", type: "property", detail: "Object metadata", boost: 9 },
    { label: "spec", type: "property", detail: "Desired state", boost: 8 },
    { label: "status", type: "property", detail: "Current state", boost: 7 },
  ];

  const K8S_METADATA = [
    { label: "name", type: "property", detail: "Resource name" },
    { label: "namespace", type: "property", detail: "Namespace" },
    { label: "labels", type: "property", detail: "Key-value labels" },
    { label: "annotations", type: "property", detail: "Annotations" },
    { label: "generateName", type: "property", detail: "Name prefix" },
    { label: "finalizers", type: "property", detail: "Finalizers list" },
    { label: "ownerReferences", type: "property", detail: "Owner refs" },
  ];

  const K8S_SPEC_CONTAINER = [
    { label: "name", type: "property", detail: "Container name" },
    { label: "image", type: "property", detail: "Container image" },
    { label: "imagePullPolicy", type: "property", detail: "Pull policy" },
    { label: "command", type: "property", detail: "Entrypoint" },
    { label: "args", type: "property", detail: "Arguments" },
    { label: "ports", type: "property", detail: "Port list" },
    { label: "env", type: "property", detail: "Env variables" },
    { label: "envFrom", type: "property", detail: "Env from source" },
    { label: "resources", type: "property", detail: "CPU/memory" },
    { label: "volumeMounts", type: "property", detail: "Volume mounts" },
    { label: "livenessProbe", type: "property", detail: "Liveness check" },
    { label: "readinessProbe", type: "property", detail: "Readiness check" },
    { label: "startupProbe", type: "property", detail: "Startup check" },
    { label: "securityContext", type: "property", detail: "Security settings" },
    { label: "lifecycle", type: "property", detail: "Lifecycle hooks" },
    { label: "workingDir", type: "property", detail: "Working directory" },
    { label: "terminationMessagePath", type: "property", detail: "Term msg path" },
    { label: "terminationMessagePolicy", type: "property", detail: "Term msg policy" },
  ];

  const K8S_SPEC_POD = [
    { label: "containers", type: "property", detail: "Container list" },
    { label: "initContainers", type: "property", detail: "Init containers" },
    { label: "volumes", type: "property", detail: "Volume list" },
    { label: "serviceAccountName", type: "property", detail: "Service account" },
    { label: "nodeSelector", type: "property", detail: "Node selection" },
    { label: "tolerations", type: "property", detail: "Node tolerations" },
    { label: "affinity", type: "property", detail: "Scheduling affinity" },
    { label: "restartPolicy", type: "property", detail: "Restart policy" },
    { label: "terminationGracePeriodSeconds", type: "property", detail: "Grace period" },
    { label: "dnsPolicy", type: "property", detail: "DNS policy" },
    { label: "hostNetwork", type: "property", detail: "Use host network" },
    { label: "securityContext", type: "property", detail: "Pod security" },
    { label: "imagePullSecrets", type: "property", detail: "Pull secrets" },
    { label: "priorityClassName", type: "property", detail: "Priority class" },
  ];

  const K8S_RESOURCES = [
    { label: "requests", type: "property", detail: "Min resources" },
    { label: "limits", type: "property", detail: "Max resources" },
    { label: "cpu", type: "property", detail: "CPU cores" },
    { label: "memory", type: "property", detail: "Memory bytes" },
  ];

  // -- kind values (context-aware: suggested after "kind:") -------------------

  const K8S_KIND_VALUES = [
    { label: "Deployment", type: "enum", detail: "apps/v1" },
    { label: "StatefulSet", type: "enum", detail: "apps/v1" },
    { label: "DaemonSet", type: "enum", detail: "apps/v1" },
    { label: "ReplicaSet", type: "enum", detail: "apps/v1" },
    { label: "Job", type: "enum", detail: "batch/v1" },
    { label: "CronJob", type: "enum", detail: "batch/v1" },
    { label: "Pod", type: "enum", detail: "v1" },
    { label: "Service", type: "enum", detail: "v1" },
    { label: "ConfigMap", type: "enum", detail: "v1" },
    { label: "Secret", type: "enum", detail: "v1" },
    { label: "Namespace", type: "enum", detail: "v1" },
    { label: "ServiceAccount", type: "enum", detail: "v1" },
    { label: "PersistentVolumeClaim", type: "enum", detail: "v1" },
    { label: "PersistentVolume", type: "enum", detail: "v1" },
    { label: "Ingress", type: "enum", detail: "networking.k8s.io/v1" },
    { label: "NetworkPolicy", type: "enum", detail: "networking.k8s.io/v1" },
    { label: "HorizontalPodAutoscaler", type: "enum", detail: "autoscaling/v2" },
    { label: "PodDisruptionBudget", type: "enum", detail: "policy/v1" },
    { label: "Role", type: "enum", detail: "rbac.authorization.k8s.io/v1" },
    { label: "RoleBinding", type: "enum", detail: "rbac.authorization.k8s.io/v1" },
    { label: "ClusterRole", type: "enum", detail: "rbac.authorization.k8s.io/v1" },
    { label: "ClusterRoleBinding", type: "enum", detail: "rbac.authorization.k8s.io/v1" },
    { label: "StorageClass", type: "enum", detail: "storage.k8s.io/v1" },
    { label: "ResourceQuota", type: "enum", detail: "v1" },
    { label: "LimitRange", type: "enum", detail: "v1" },
  ];

  // -- apiVersion values (context-aware: suggested after "apiVersion:") -------

  const K8S_API_VERSIONS = [
    { label: "v1", type: "enum", detail: "Core API" },
    { label: "apps/v1", type: "enum", detail: "Deployments, StatefulSets, DaemonSets" },
    { label: "batch/v1", type: "enum", detail: "Jobs, CronJobs" },
    { label: "networking.k8s.io/v1", type: "enum", detail: "Ingress, NetworkPolicy" },
    { label: "rbac.authorization.k8s.io/v1", type: "enum", detail: "RBAC" },
    { label: "autoscaling/v2", type: "enum", detail: "HPA" },
    { label: "policy/v1", type: "enum", detail: "PDB" },
    { label: "storage.k8s.io/v1", type: "enum", detail: "StorageClass, CSI" },
    { label: "admissionregistration.k8s.io/v1", type: "enum", detail: "Webhooks" },
    { label: "coordination.k8s.io/v1", type: "enum", detail: "Leases" },
    { label: "discovery.k8s.io/v1", type: "enum", detail: "EndpointSlice" },
    { label: "gateway.networking.k8s.io/v1", type: "enum", detail: "Gateway API" },
  ];

  // -- Common label/annotation keys ------------------------------------------

  const K8S_LABEL_KEYS = [
    { label: "app.kubernetes.io/name", type: "property", detail: "App name" },
    { label: "app.kubernetes.io/instance", type: "property", detail: "Instance ID" },
    { label: "app.kubernetes.io/version", type: "property", detail: "App version" },
    { label: "app.kubernetes.io/component", type: "property", detail: "Component" },
    { label: "app.kubernetes.io/part-of", type: "property", detail: "Part of" },
    { label: "app.kubernetes.io/managed-by", type: "property", detail: "Manager" },
    { label: "app", type: "property", detail: "Legacy app label" },
    { label: "environment", type: "property", detail: "Environment" },
    { label: "tier", type: "property", detail: "Tier (frontend, backend)" },
    { label: "release", type: "property", detail: "Release name" },
  ];

  const K8S_ANNOTATION_KEYS = [
    { label: "kubernetes.io/ingress.class", type: "property", detail: "Ingress class" },
    { label: "kubernetes.io/change-cause", type: "property", detail: "Change cause" },
    {
      label: "kubectl.kubernetes.io/last-applied-configuration",
      type: "property",
      detail: "Last applied",
    },
    { label: "prometheus.io/scrape", type: "property", detail: "Enable scraping" },
    { label: "prometheus.io/port", type: "property", detail: "Scrape port" },
    { label: "prometheus.io/path", type: "property", detail: "Scrape path" },
  ];

  // -- Service spec fields ---------------------------------------------------

  const K8S_SPEC_SERVICE = [
    { label: "type", type: "property", detail: "ClusterIP, NodePort, LoadBalancer" },
    { label: "selector", type: "property", detail: "Pod selector" },
    { label: "ports", type: "property", detail: "Port mappings" },
    { label: "clusterIP", type: "property", detail: "Cluster IP" },
    { label: "externalTrafficPolicy", type: "property", detail: "External traffic policy" },
    { label: "sessionAffinity", type: "property", detail: "Session affinity" },
    { label: "loadBalancerIP", type: "property", detail: "LB IP" },
    { label: "loadBalancerSourceRanges", type: "property", detail: "LB source ranges" },
  ];

  // -- Ingress spec fields ---------------------------------------------------

  const K8S_SPEC_INGRESS = [
    { label: "ingressClassName", type: "property", detail: "Ingress class" },
    { label: "tls", type: "property", detail: "TLS config" },
    { label: "rules", type: "property", detail: "Routing rules" },
    { label: "defaultBackend", type: "property", detail: "Default backend" },
  ];

  // -- Deployment/StatefulSet spec fields ------------------------------------

  const K8S_SPEC_WORKLOAD = [
    { label: "replicas", type: "property", detail: "Pod replicas" },
    { label: "selector", type: "property", detail: "Label selector" },
    { label: "template", type: "property", detail: "Pod template" },
    { label: "strategy", type: "property", detail: "Update strategy" },
    { label: "minReadySeconds", type: "property", detail: "Min ready seconds" },
    { label: "revisionHistoryLimit", type: "property", detail: "Revision history limit" },
    { label: "progressDeadlineSeconds", type: "property", detail: "Progress deadline" },
  ];

  const K8S_SNIPPETS = [
    {
      label: "container",
      type: "text",
      detail: "Container block",
      apply:
        "- name: app\n  image: nginx:latest\n  ports:\n    - containerPort: 80\n  resources:\n    requests:\n      cpu: 100m\n      memory: 128Mi\n    limits:\n      cpu: 500m\n      memory: 256Mi",
    },
    {
      label: "volume-mount",
      type: "text",
      detail: "Volume mount",
      apply: "- name: data\n  mountPath: /data\n  readOnly: false",
    },
    {
      label: "env-secret",
      type: "text",
      detail: "Env from Secret",
      apply:
        "- name: SECRET_KEY\n  valueFrom:\n    secretKeyRef:\n      name: my-secret\n      key: key",
    },
    {
      label: "env-configmap",
      type: "text",
      detail: "Env from ConfigMap",
      apply:
        "- name: CONFIG_VAL\n  valueFrom:\n    configMapKeyRef:\n      name: my-config\n      key: key",
    },
    {
      label: "liveness-http",
      type: "text",
      detail: "HTTP liveness probe",
      apply:
        "livenessProbe:\n  httpGet:\n    path: /healthz\n    port: 8080\n  initialDelaySeconds: 15\n  periodSeconds: 10",
    },
    {
      label: "readiness-http",
      type: "text",
      detail: "HTTP readiness probe",
      apply:
        "readinessProbe:\n  httpGet:\n    path: /ready\n    port: 8080\n  initialDelaySeconds: 5\n  periodSeconds: 5",
    },
    {
      label: "volume-emptydir",
      type: "text",
      detail: "EmptyDir volume",
      apply: "- name: data\n  emptyDir: {}",
    },
    {
      label: "volume-configmap",
      type: "text",
      detail: "ConfigMap volume",
      apply: "- name: config\n  configMap:\n    name: my-config",
    },
    {
      label: "volume-secret",
      type: "text",
      detail: "Secret volume",
      apply: "- name: creds\n  secret:\n    secretName: my-secret",
    },
    {
      label: "toleration",
      type: "text",
      detail: "Node toleration",
      apply:
        "- key: node-role.kubernetes.io/control-plane\n  operator: Exists\n  effect: NoSchedule",
    },
    {
      label: "security-restricted",
      type: "text",
      detail: "Restricted security context",
      apply:
        "securityContext:\n  runAsNonRoot: true\n  allowPrivilegeEscalation: false\n  capabilities:\n    drop:\n      - ALL\n  seccompProfile:\n    type: RuntimeDefault",
    },
  ];

  function detectDocumentKind(doc: string, cursorPos: number): string | null {
    const before = doc.slice(0, cursorPos);
    const lines = before.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const kindMatch = lines[i].match(/^kind:\s*(\S+)/);
      if (kindMatch) return kindMatch[1];
      // Stop at document separator
      if (/^---\s*$/.test(lines[i])) break;
    }
    return null;
  }

  function k8sCompletion(context: CompletionContext): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    // Value completion: "kind: D|" or "apiVersion: a|"
    const valueMatch = textBefore.match(/^(\s*)(kind|apiVersion):\s*(\S*)$/);
    if (valueMatch) {
      const word = valueMatch[3];
      const from = context.pos - word.length;
      if (valueMatch[2] === "kind") {
        return { from, options: K8S_KIND_VALUES };
      }
      return { from, options: K8S_API_VERSIONS };
    }

    // Key completion: "  key|"
    const match = textBefore.match(/^(\s*)([\w./-]*)$/);
    if (!match) return null;

    const indent = match[1].length;
    const word = match[2];
    const from = context.pos - word.length;

    const doc = context.state.doc.toString();
    const kind = detectDocumentKind(doc, context.pos);

    let options: { label: string; type: string; detail: string; apply?: string; boost?: number }[] =
      [...K8S_SNIPPETS];

    if (indent === 0) {
      options = [...K8S_TOP_LEVEL, ...K8S_SNIPPETS];
    } else if (indent <= 2) {
      const linesBefore = doc.slice(0, context.pos).split("\n");
      for (let i = linesBefore.length - 1; i >= 0; i--) {
        const l = linesBefore[i].trimEnd();
        if (l === "metadata:") {
          options = [...K8S_METADATA, ...K8S_SNIPPETS];
          break;
        }
        if (/^\s*labels:/.test(l) || /^\s*annotations:/.test(l)) {
          options = l.includes("annotations:") ? [...K8S_ANNOTATION_KEYS] : [...K8S_LABEL_KEYS];
          break;
        }
        if (l === "spec:" || l.endsWith("template:")) {
          // Context-aware spec: use kind to pick the right completions
          if (kind === "Service") {
            options = [...K8S_SPEC_SERVICE, ...K8S_SNIPPETS];
            break;
          }
          if (kind === "Ingress") {
            options = [...K8S_SPEC_INGRESS, ...K8S_SNIPPETS];
            break;
          }
          if (
            kind === "Deployment" ||
            kind === "StatefulSet" ||
            kind === "DaemonSet" ||
            kind === "ReplicaSet"
          ) {
            options = [...K8S_SPEC_WORKLOAD, ...K8S_SPEC_POD, ...K8S_SNIPPETS];
            break;
          }
          options = [...K8S_SPEC_POD, ...K8S_SNIPPETS];
          break;
        }
        if (/^\s*-\s+name:/.test(l) || l.includes("containers:")) {
          options = [...K8S_SPEC_CONTAINER, ...K8S_SNIPPETS];
          break;
        }
        if (l === "  resources:" || l === "    resources:") {
          options = [...K8S_RESOURCES, ...K8S_SNIPPETS];
          break;
        }
        if (/^\S/.test(l) && l !== "") break;
      }
    } else {
      const linesBefore = doc.slice(0, context.pos).split("\n");
      for (let i = linesBefore.length - 1; i >= 0; i--) {
        const l = linesBefore[i].trimEnd();
        if (/labels:|matchLabels:/.test(l)) {
          options = [...K8S_LABEL_KEYS];
          break;
        }
        if (/annotations:/.test(l)) {
          options = [...K8S_ANNOTATION_KEYS];
          break;
        }
        if (/containers:|initContainers:/.test(l)) {
          options = [...K8S_SPEC_CONTAINER, ...K8S_SNIPPETS];
          break;
        }
        if (/resources:/.test(l)) {
          options = [...K8S_RESOURCES, ...K8S_SNIPPETS];
          break;
        }
        if (/^\s{0,2}\S/.test(l) && l !== "") break;
      }
    }

    if (word.length === 0 && !context.explicit) return null;

    return { from, options };
  }

  // -- Hover tooltips for K8s fields (Feature 4) ------------------------------

  function k8sHoverTooltip(view: EditorView, pos: number): Tooltip | null {
    const line = view.state.doc.lineAt(pos);
    const lineText = line.text;

    const fieldName = extractFieldAtPosition(lineText);
    if (!fieldName) return null;

    // Get path context for better documentation
    const doc = view.state.doc.toString();
    const pathSegments = getYamlPathAtOffset(doc, pos);
    const pathContext = pathSegments.map((s) => s.key);

    const docText = getFieldDoc(fieldName, pathContext);
    if (!docText) return null;

    // Position tooltip at the field name
    const keyMatch = lineText.match(/^(\s*-?\s*)([\w./$@~-]+)\s*:/);
    if (!keyMatch) return null;

    const from = line.from + keyMatch[1].length;
    const to = from + keyMatch[2].length;

    // Only show tooltip if cursor is over the key
    if (pos < from || pos > to) return null;

    return {
      pos: from,
      end: to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-k8s-hover";
        dom.style.padding = "8px 12px";
        dom.style.fontSize = "12px";
        dom.style.lineHeight = "1.5";

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.color = "#7dd3fc";
        title.style.marginBottom = "4px";
        title.textContent = fieldName;

        const desc = document.createElement("div");
        desc.style.color = "#cbd5e1";
        desc.textContent = docText;

        if (pathContext.length > 1) {
          const pathEl = document.createElement("div");
          pathEl.style.color = "#64748b";
          pathEl.style.fontSize = "10px";
          pathEl.style.marginTop = "4px";
          pathEl.textContent = pathContext.join(" > ");
          dom.appendChild(title);
          dom.appendChild(desc);
          dom.appendChild(pathEl);
        } else {
          dom.appendChild(title);
          dom.appendChild(desc);
        }

        return { dom };
      },
    };
  }

  // -- YAML path tracking (Features 3, 6, 7) ---------------------------------

  function emitPathAndDocs(editorView: EditorView) {
    const doc = editorView.state.doc.toString();
    const pos = editorView.state.selection.main.head;

    // Emit path segments
    if (onPathChange) {
      const segments = getYamlPathAtOffset(doc, pos);
      onPathChange(segments);
    }

    // Emit document info
    if (onDocumentsChange) {
      const docs = parseYamlDocuments(doc);
      const currentDoc = getDocumentAtOffset(docs, pos);
      const activeIndex = currentDoc ? currentDoc.index : 0;
      onDocumentsChange(docs, activeIndex);
    }
  }

  // -- Copy YAML path (Feature 7) --------------------------------------------

  function copyYamlPath(editorView: EditorView): boolean {
    const doc = editorView.state.doc.toString();
    const pos = editorView.state.selection.main.head;
    const segments = getYamlPathAtOffset(doc, pos);
    if (segments.length === 0) return false;

    const dotPath = formatYamlPathDot(segments);
    navigator.clipboard.writeText(dotPath);
    return true;
  }

  function yamlLinter(editorView: EditorView): Diagnostic[] {
    const doc = editorView.state.doc.toString();
    if (!doc.trim()) return [];

    const lineStart = (lineNo: number) => editorView.state.doc.line(lineNo).from;
    const lineLen = (pos: number) => editorView.state.doc.lineAt(pos).length;
    const totalLines = editorView.state.doc.lines;
    const docLength = editorView.state.doc.length;

    // Syntax errors (multi-document aware)
    const syntaxErrors = validateYamlSyntax(doc, lineStart, lineLen, totalLines, docLength);
    if (syntaxErrors.length > 0) return syntaxErrors;

    // Duplicate key detection
    const dupeWarnings = detectDuplicateKeys(doc, lineStart, lineLen);

    // Indentation checks
    const indentWarnings = checkIndentation(doc, lineStart, lineLen);

    // Schedule async kubeconform validation (runs separately, merges results)
    scheduleKubeconform(editorView);

    return [...dupeWarnings, ...indentWarnings];
  }

  // -- Kubeconform async schema validation ------------------------------------

  let kubeconformGeneration = 0;
  let kubeconformTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleKubeconform(editorView: EditorView) {
    if (kubeconformTimer) clearTimeout(kubeconformTimer);
    kubeconformTimer = setTimeout(() => void runKubeconformLint(editorView), 2000);
  }

  async function runKubeconformLint(editorView: EditorView) {
    const doc = editorView.state.doc.toString();
    if (!doc.trim()) return;

    // Only run on K8s manifests (must have apiVersion or kind)
    if (!doc.includes("apiVersion:") && !doc.includes("kind:")) return;

    const generation = ++kubeconformGeneration;
    try {
      const dataDir = await appDataDir();
      const tmpDir = `${dataDir}yaml-lint`;
      await mkdir("yaml-lint", { baseDir: 11 /* AppData */, recursive: true });
      const tmpFile = `${tmpDir}/lint-buffer.yaml`;
      await writeTextFile(tmpFile, doc);

      const result = await execCli("kubeconform", [
        "-output",
        "json",
        "-schema-location",
        "default",
        "-strict",
        tmpFile,
      ]);

      // Stale result - newer edit happened
      if (generation !== kubeconformGeneration || !view) return;

      const output = (result.stdout || "") + (result.stderr || "");
      const parsed = parseKubeconformOutput(output);
      const invalid = parsed.filter((r) => r.status === "INVALID" || r.status === "ERROR");
      if (invalid.length === 0) return;

      const lineStart = (lineNo: number) => editorView.state.doc.line(lineNo).from;
      const lineLen = (pos: number) => editorView.state.doc.lineAt(pos).length;
      const docLength = editorView.state.doc.length;

      const schemaDiags = kubeconformToDiagnostics(invalid, doc, lineStart, lineLen, docLength);
      if (schemaDiags.length > 0) {
        // Inject schema diagnostics via forceUpdate on the linter
        editorView.dispatch({ effects: setKubeconformResults.of(schemaDiags) });
      }
    } catch {
      // kubeconform not available - silently skip
    }
  }

  // Store kubeconform results as a StateField so they persist across lint cycles
  const setKubeconformResults = StateEffect.define<Diagnostic[]>();

  const kubeconformField = StateField.define<Diagnostic[]>({
    create() {
      return [];
    },
    update(current, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setKubeconformResults)) return effect.value;
      }
      // Clear on document change (new lint cycle will repopulate)
      if (tr.docChanged) return [];
      return current;
    },
  });

  // -- Navigate to line (used by breadcrumb) ----------------------------------

  export function navigateToLine(lineNo: number) {
    if (!view) return;
    const line = view.state.doc.line(Math.min(lineNo, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  }

  let lintPanelOpen = $state(false);

  export function copyPathAtCursor(): boolean {
    if (!view) return false;
    return copyYamlPath(view);
  }

  export function toggleLintPanel(): boolean {
    if (!view) return false;
    if (lintPanelOpen) {
      closeLintPanel(view);
      lintPanelOpen = false;
    } else {
      openLintPanel(view);
      lintPanelOpen = true;
    }
    view.focus();
    return true;
  }

  function buildExtensions(): Extension[] {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      foldGutter({
        openText: "\u25BE",
        closedText: "\u25B8",
      }),
      drawSelection(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      scrollPastEnd(),
      indentUnit.of("  "),
      yaml(),
      syntaxHighlighting(rozoomHighlight),
      rozoomTheme,
      autocompletion({
        override: [k8sCompletion],
        icons: false,
      }),
      linter(yamlLinter, { delay: 500 }),
      kubeconformField,
      linter((editorView) => editorView.state.field(kubeconformField), { delay: 100 }),
      lintGutter(),
      hoverTooltip(k8sHoverTooltip, { hoverTime: 300 }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        {
          key: "Mod-s",
          run: () => {
            onSave?.();
            return true;
          },
        },
        {
          key: "Mod-Shift-c",
          run: (v) => copyYamlPath(v),
        },
      ]),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && !skipNextUpdate) {
          onChange?.(update.state.doc.toString());
        }
        skipNextUpdate = false;
        // Emit path/docs on cursor move or doc change
        if (update.selectionSet || update.docChanged) {
          emitPathAndDocs(update.view);
        }
      }),
      readonlyCompartment.of(EditorState.readOnly.of(readonly)),
      highlightedLinesField,
      EditorView.lineWrapping,
    ];
  }

  function createView() {
    if (!container) return;
    view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: buildExtensions(),
      }),
      parent: container,
    });
  }

  $effect(() => {
    const v = value;
    if (!viewReady || !view) return;
    const currentDoc = view.state.doc.toString();
    if (v !== currentDoc) {
      skipNextUpdate = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: v },
      });
    }
  });

  $effect(() => {
    const r = readonly;
    if (!viewReady || !view) return;
    view.dispatch({
      effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(r)),
    });
  });

  $effect(() => {
    const el = errorLines;
    const dl = diffLines;
    if (!viewReady || !view) return;
    view.dispatch({
      effects: setHighlightedLines.of({ errorLines: el, diffLines: dl }),
    });
  });

  onMount(() => {
    createView();
    viewReady = true;
  });

  onDestroy(() => {
    view?.destroy();
  });
</script>

<div
  bind:this={container}
  class="yaml-editor h-full w-full min-h-0 min-w-0 flex-1 overflow-hidden rounded border border-slate-700"
></div>

<style>
  .yaml-editor :global(.cm-editor) {
    height: 100%;
  }
  .yaml-editor :global(.cm-scroller) {
    overflow: auto;
  }
</style>

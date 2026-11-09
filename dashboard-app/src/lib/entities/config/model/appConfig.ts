export type AppClusterConfig = {
  uuid: string;
  name: string;
  displayName?: string;
  addedAt: Date;
  env?: string;
  provider?: string;
  source?: string;
  tags?: string[];
  pinned?: boolean;
  lastSeenOnline?: Date;
  offline?: boolean;
  status?: string;
  errors?: string;
  needsInitialRefreshHint?: boolean;
  defaultNamespace?: string;
  readOnly?: boolean;
  removedAt?: string;
  proxyUrl?: string;
  pinnedKubectlVersion?: string;
  pinnedHelmVersion?: string;
};

export class KubeCluster {
  name: string;
  server?: string;
  certificateAuthority?: string;
  insecureSkipTlsVerify?: boolean;
  constructor(
    name: string,
    opts?: { server?: string; certificateAuthority?: string; insecureSkipTlsVerify?: boolean },
  ) {
    this.name = name;
    this.server = opts?.server;
    this.certificateAuthority = opts?.certificateAuthority;
    this.insecureSkipTlsVerify = opts?.insecureSkipTlsVerify;
  }
}

export class KubeContext {
  name: string;
  context: {
    user: string;
    cluster: string;
  };
  constructor(name: string, context: { user: string; cluster: string }) {
    this.name = name;
    this.context = context;
  }
}

export class KubeUser {
  name: string;
  execCommand?: string;
  execArgs?: string[];
  authProvider?: string;
  hasToken?: boolean;
  hasCertAuth?: boolean;
  constructor(
    name: string,
    opts?: {
      execCommand?: string;
      execArgs?: string[];
      authProvider?: string;
      hasToken?: boolean;
      hasCertAuth?: boolean;
    },
  ) {
    this.name = name;
    this.execCommand = opts?.execCommand;
    this.execArgs = opts?.execArgs;
    this.authProvider = opts?.authProvider;
    this.hasToken = opts?.hasToken;
    this.hasCertAuth = opts?.hasCertAuth;
  }
}

export class KubeConfig {
  apiVersion: string;
  kind: string;
  clusters: KubeCluster[];
  contexts: KubeContext[];
  users: KubeUser[];
  /**
   * File the config was read from. Empty for the merged view kubectl builds from
   * $KUBECONFIG and ~/.kube/config: kubectl calls about such a config pass no
   * --kubeconfig so they resolve exactly as the list was built.
   */
  path: string;
  /** `current-context` from the file, when set. */
  currentContext?: string;

  constructor({
    clusters,
    contexts,
    users,
    apiVersion,
    kind,
    path,
    currentContext,
  }: {
    apiVersion: string;
    kind: string;
    clusters: KubeCluster[];
    contexts: KubeContext[];
    users: KubeUser[];
    path: string;
    currentContext?: string;
  }) {
    this.apiVersion = apiVersion;
    this.kind = kind;
    this.clusters = clusters;
    this.contexts = contexts;
    this.users = users;
    this.path = path;
    this.currentContext = currentContext;
  }
}

export type KubeClusterType = KubeCluster;
export type KubeConfigFileType = KubeConfig;

export const CONFIG_DIR = "configs";

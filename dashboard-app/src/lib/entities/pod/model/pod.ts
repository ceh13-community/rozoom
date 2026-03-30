export type ContainerEnv = {
  name: string;
  valueFrom?: {
    [key: string]: {
      [key: string]: string;
    };
  };
  value?: string;
};

export interface Container {
  name: string;
  image: string;
  imagePullPolicy?: string;
  command?: string[];
  args?: string[];
  ports?: Array<{
    name: string;
    containerPort: number;
    protocol?: string;
  }>;
  workingDir?: string;
  env?: ContainerEnv[];
  resources?: {
    limits?: {
      cpu?: string;
      memory?: string;
    };
    requests?: {
      cpu?: string;
      memory?: string;
    };
  };
  readinessProbe?: {
    httpGet?: {
      path?: string;
      port?: string | number;
      scheme?: string;
    };
    initialDelaySeconds?: number;
    periodSeconds?: number;
    timeoutSeconds?: number;
    successThreshold?: number;
    failureThreshold?: number;
  };
  livenessProbe?: {
    httpGet?: {
      path?: string;
      port?: string | number;
      scheme?: string;
    };
    initialDelaySeconds?: number;
    periodSeconds?: number;
    timeoutSeconds?: number;
    successThreshold?: number;
    failureThreshold?: number;
  };
  startupProbe?: {
    httpGet?: {
      path?: string;
      port?: string | number;
      scheme?: string;
    };
    initialDelaySeconds?: number;
    periodSeconds?: number;
    timeoutSeconds?: number;
    successThreshold?: number;
    failureThreshold?: number;
  };
  volumeMounts?: Array<{
    name: string;
    mountPath: string;
    readOnly?: boolean;
  }>;
}

export interface EmptyDirVolume {
  emptyDir: Record<string, unknown>;
  name: string;
}

export interface SecretVolume {
  name: string;
  secret: {
    secretName?: string;
    defaultMode?: number;
    optional?: boolean;
    items?: { key: string; path: string }[];
  };
}

export interface ProjectedVolume {
  name: string;
  projected: {
    defaultMode?: number;
    sources?: Array<{
      serviceAccountToken?: { expirationSeconds: number; path: string };
      configMap?: { name: string; items?: { key: string; path: string }[] };
      downwardAPI?: {
        items?: {
          fieldRef: { apiVersion: string; fieldPath: string };
          path: string;
        }[];
      };
    }>;
  };
}

export interface HostPathVolume {
  name: string;
  hostPath?: {
    path?: string;
    type?: string;
  };
}

export interface PVCVolume {
  name: string;
  persistentVolumeClaim: {
    claimName: string;
    readOnly?: boolean;
  };
}

export interface ConfigMapVolume {
  name: string;
  configMap: {
    name: string;
    items?: { key: string; path: string }[];
    defaultMode?: number;
    optional?: boolean;
  };
}

export type TVolume =
  | SecretVolume
  | EmptyDirVolume
  | ProjectedVolume
  | HostPathVolume
  | PVCVolume
  | ConfigMapVolume;

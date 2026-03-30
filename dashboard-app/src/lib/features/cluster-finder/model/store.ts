import * as Sentry from "@sentry/sveltekit";
import { error } from "@tauri-apps/plugin-log";
import { writable } from "svelte/store";
import { scanKubeconfigs } from "../api/scanner";
import { KubeConfig, type KubeConfigFileType } from "$entities/config";

export const kubeConfigFile = writable<KubeConfigFileType | null>(null);
export const isKubeConfigLoading = writable(false);
export const kubeConfigError = writable<string | null>(null);
export const kubeConfigSuccess = writable<string | null>(null);

export async function loadKubeconfig() {
  isKubeConfigLoading.set(true);
  clearKubeConfigMessages();

  const config = await scanKubeconfigs();

  if (!config) {
    isKubeConfigLoading.set(false);
    await error("Error loading kubeconfig");
    Sentry.captureException("Error loading kubeconfig");

    return;
  }

  const kubeConfig = new KubeConfig(config);

  kubeConfigFile.set(kubeConfig);
  isKubeConfigLoading.set(false);
}

export function clearKubeConfigMessages(): void {
  kubeConfigError.set(null);
  kubeConfigSuccess.set(null);
}

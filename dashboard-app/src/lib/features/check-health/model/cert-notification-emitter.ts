import type { CertificatesReport } from "./types";
import type { TlsCertInfo } from "../api/check-tls-certificates";
import { pushCertificateNotification } from "$shared/lib/app-notifications";

const emittedKeys = new Set<string>();

export function emitCertNotifications(
  clusterId: string,
  clusterName: string,
  report: CertificatesReport | undefined | null,
) {
  if (!report || report.status === "ok" || report.status === "unknown") return;

  for (const cert of report.certificates) {
    if (cert.status !== "warning" && cert.status !== "critical") continue;
    const key = `cp:${clusterId}:${cert.name}`;
    if (emittedKeys.has(key)) continue;
    emittedKeys.add(key);

    pushCertificateNotification({
      clusterId,
      clusterName,
      certName: `[control-plane] ${cert.name}`,
      daysLeft: cert.daysLeft ?? 0,
      status: cert.status,
    });
  }
}

export function emitTlsCertNotifications(
  clusterId: string,
  clusterName: string,
  certs: TlsCertInfo[],
) {
  for (const cert of certs) {
    if (cert.status !== "warning" && cert.status !== "critical") continue;
    const key = `tls:${clusterId}:${cert.namespace}/${cert.name}`;
    if (emittedKeys.has(key)) continue;
    emittedKeys.add(key);

    const label =
      cert.type === "cert-manager"
        ? `[cert-manager] ${cert.namespace}/${cert.name}`
        : `[TLS] ${cert.namespace}/${cert.name}`;

    pushCertificateNotification({
      clusterId,
      clusterName,
      certName: label,
      daysLeft: cert.daysLeft ?? 0,
      status: cert.status,
    });
  }
}

export function resetCertNotificationEmitter() {
  emittedKeys.clear();
}

<script lang="ts">
  import * as Table from "$shared/ui/table";
  import SecretVolumeComponent from "./volumes/secret-volume.svelte";
  import EmptyDirVolumeComponent from "./volumes/empty-dir-volume.svelte";
  import ProjectedVolumeComponent from "./volumes/projected-volume.svelte";
  import PvcVolumeComponent from "./volumes/pvc-volume.svelte";
  import HostPathVolumeComponent from "./volumes/host-path-volume.svelte";
  import ConfigMapVolumeComponent from "./volumes/config-map-volume.svelte";
  import type {
    ConfigMapVolume,
    EmptyDirVolume,
    HostPathVolume,
    ProjectedVolume,
    PVCVolume,
    SecretVolume,
    TVolume,
  } from "$entities/pod";

  export let volumes: TVolume[];

  interface GroupedVolumes {
    secret?: SecretVolume[];
    projected?: ProjectedVolume[];
    emptyDir?: EmptyDirVolume[];
    persistentVolumeClaim?: PVCVolume[];
    hostPath?: HostPathVolume[];
    configMap?: ConfigMapVolume[];
    [key: string]: TVolume[] | undefined;
  }

  function groupVolumes(volumes: TVolume[]): GroupedVolumes {
    return volumes.reduce((acc: GroupedVolumes, volume) => {
      const type = Object.keys(volume).find((key) => key !== "name") || "unknown";
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type]!.push(volume);
      return acc;
    }, {});
  }
  const groupedVolumes = groupVolumes(volumes);
</script>

<Table.Root>
  <Table.Body>
    {#if groupedVolumes.secret && groupedVolumes.secret.length}
      <SecretVolumeComponent volumes={groupedVolumes.secret} />
    {/if}
    {#if groupedVolumes.emptyDir && groupedVolumes.emptyDir.length}
      <EmptyDirVolumeComponent volumes={groupedVolumes.emptyDir} />
    {/if}
    {#if groupedVolumes.projected && groupedVolumes.projected.length}
      <ProjectedVolumeComponent volumes={groupedVolumes.projected} />
    {/if}
    {#if groupedVolumes.persistentVolumeClaim && groupedVolumes.persistentVolumeClaim.length}
      <PvcVolumeComponent volumes={groupedVolumes.persistentVolumeClaim} />
    {/if}
    {#if groupedVolumes.hostPath && groupedVolumes.hostPath.length}
      <HostPathVolumeComponent volumes={groupedVolumes.hostPath} />
    {/if}
    {#if groupedVolumes.configMap && groupedVolumes.configMap.length}
      <ConfigMapVolumeComponent volumes={groupedVolumes.configMap} />
    {/if}
  </Table.Body>
</Table.Root>

<style></style>

<script lang="ts">
  import { writable } from "svelte/store";
  import { ChevronDown, ChevronUp } from "$shared/ui/icons";
  import { getEnvironmentInfo, type Container } from "$entities/pod/";
  import * as Table from "$shared/ui/table";

  export let containers: Container[];

  const expandedFields = writable(new Set<string>());

  function toggleExpand(field: string) {
    expandedFields.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(field)) {
        newSet.delete(field);
      } else {
        newSet.add(field);
      }
      return newSet;
    });
  }
</script>

{#each containers as container}
  <h4 class="font-bold">{container.name}</h4>
  <Table.Root>
    <Table.Body>
      <Table.Row>
        <Table.Cell width="180">Status</Table.Cell>
        <Table.Cell>?</Table.Cell>
      </Table.Row>
      {#if container.image}
        <Table.Row>
          <Table.Cell>Image</Table.Cell>
          <Table.Cell>{container.image}</Table.Cell>
        </Table.Row>
      {/if}
      {#if container.ports}
        <Table.Row>
          <Table.Cell>Ports</Table.Cell>
          <Table.Cell>
            {#each container?.ports as port}
              <div class="flex items-center">
                {port.name}:{port.containerPort}/{port.protocol}
              </div>
            {/each}
          </Table.Cell>
        </Table.Row>
      {/if}
      {#if container.env}
        <Table.Row onclick={() => toggleExpand("env")}>
          <Table.Cell>
            <div class="flex items-center">
              <span>Environment</span>
              {#if container.env.length}
                {#if $expandedFields.has("env")}
                  <ChevronUp class="h-4 w-4" />
                {:else}
                  <ChevronDown class="h-4 w-4" />
                {/if}
              {/if}
            </div>
          </Table.Cell>
          <Table.Cell>
            {#if $expandedFields.has("env")}
              {#each container.env.sort((a, b) => a.name.localeCompare(b.name)) as env}
                <div class="flex items-center">
                  {getEnvironmentInfo(env)}
                </div>
              {/each}
            {:else}
              {container.env.length} Environmental Variables
            {/if}
          </Table.Cell>
        </Table.Row>
      {/if}
      {#if container.volumeMounts}
        <Table.Row onclick={() => toggleExpand("volumeMounts")}>
          <Table.Cell>
            <div class="flex items-center">
              <span>Mounts</span>
              {#if container.volumeMounts.length}
                {#if $expandedFields.has("env")}
                  <ChevronUp class="h-4 w-4" />
                {:else}
                  <ChevronDown class="h-4 w-4" />
                {/if}
              {/if}
            </div>
          </Table.Cell>
          <Table.Cell>
            {#if $expandedFields.has("volumeMounts")}
              {#each container.volumeMounts as mount}
                <div class="">
                  <div class="info-block">
                    {mount.mountPath}
                  </div>
                  from {mount.name}
                  {#if mount.readOnly}(ro){:else}(rw){/if}
                </div>
              {/each}
            {:else}
              {container.volumeMounts.length} Mounts
            {/if}
          </Table.Cell>
        </Table.Row>
      {/if}
      {#if container.readinessProbe}
        <Table.Row>
          <Table.Cell>Readiness</Table.Cell>
          <Table.Cell>
            {#if container.readinessProbe.httpGet}
              <span class="info-block">http-get</span>
              <span class="info-block"
                >{container.readinessProbe.httpGet.scheme?.toLocaleLowerCase()}://:{container.ports?.find(
                  (p) => p.name === container.readinessProbe?.httpGet?.port,
                )?.containerPort}{container.readinessProbe.httpGet.path}</span
              >
            {/if}
            <span class="info-block">delay={container.readinessProbe.initialDelaySeconds}s</span>
            <span class="info-block">timeout={container.readinessProbe.timeoutSeconds}s</span>
            <span class="info-block">period={container.readinessProbe.periodSeconds}s</span>
            <span class="info-block">#success={container.readinessProbe.successThreshold}</span>
            <span class="info-block">#failure={container.readinessProbe.failureThreshold}</span>
          </Table.Cell>
        </Table.Row>
      {/if}
      {#if container.args && container.args.length}
        <Table.Row>
          <Table.Cell>Arguments</Table.Cell>
          <Table.Cell>{container.args.join("  ")}</Table.Cell>
        </Table.Row>
      {/if}
      {#if container.resources}
        {#if container.resources.requests}
          <Table.Row>
            <Table.Cell>Requests</Table.Cell>
            <Table.Cell>
              <div class="flex flex-col">
                {#each Object.entries(container.resources.requests) as [key, value]}
                  <div class="flex items-center">
                    {key}: {value}
                  </div>
                {/each}
              </div>
            </Table.Cell>
          </Table.Row>
        {/if}
        {#if container.resources.limits}
          <Table.Row>
            <Table.Cell>Limits</Table.Cell>
            <Table.Cell>
              <div class="flex flex-col">
                {#each Object.entries(container.resources.limits) as [key, value]}
                  <div class="flex items-center">
                    {key}: {value}
                  </div>
                {/each}
              </div>
            </Table.Cell>
          </Table.Row>
        {/if}
      {/if}
    </Table.Body>
  </Table.Root>
{/each}

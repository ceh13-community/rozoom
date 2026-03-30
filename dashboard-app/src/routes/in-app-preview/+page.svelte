<script lang="ts">
  import InAppWebPreview from "$shared/ui/in-app-web-preview/in-app-web-preview.svelte";
  import InAppWebRedirect from "$shared/ui/in-app-web-preview/in-app-web-redirect.svelte";

  type Props = {
    data: {
      targetUrl: string;
      redirectMode?: boolean;
    };
  };

  let { data }: Props = $props();
</script>

{#if data.redirectMode}
  <InAppWebRedirect url={data.targetUrl} />
{:else}
  <InAppWebPreview url={data.targetUrl} />
{/if}

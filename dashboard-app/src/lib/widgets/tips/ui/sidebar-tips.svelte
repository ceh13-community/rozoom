<script lang="ts">
  import * as Card from "$shared/ui/card";
  import { Button } from "$shared/ui/button";
</script>

<Card.Root>
  <Card.Header class="p-2 pt-0 md:p-4">
    <Card.Title>Tip</Card.Title>
    <Card.Description>
      Choose a cluster and press Details. If you've uploaded the config and you do not see list of
      clusters, please click Refresh.
    </Card.Description>
  </Card.Header>
  <Card.Content class="p-2 pt-0 md:p-4 md:pt-0">
    <Button onclick={() => (window.location.href = "/admin")} size="sm" class="w-full"
      >Refresh</Button
    >
  </Card.Content>
</Card.Root>

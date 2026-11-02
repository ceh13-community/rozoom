<script lang="ts">
  import PrivacyPolicyLink from "./privacy-policy-link.svelte";
  import { CONSENT_PROMPT_DESCRIPTION } from "./telemetry-copy";
</script>

<!-- Rendered by svelte-sonner as the toast description: one line, link in the same line. -->
<span>{CONSENT_PROMPT_DESCRIPTION} <PrivacyPolicyLink /></span>

<script lang="ts">
  import { openExternalUrl } from "$shared/api/in-app-browser";
  import { PRIVACY_POLICY_LABEL, PRIVACY_POLICY_URL } from "./telemetry-copy";

  // A real hyperlink (href, keyboard focus, copyable), but the click goes to the
  // system browser: navigating the Tauri webview away would leave the app blank.
  function open(event: MouseEvent) {
    event.preventDefault();
    void openExternalUrl(PRIVACY_POLICY_URL);
  }
</script>

<a
  href={PRIVACY_POLICY_URL}
  rel="noopener noreferrer"
  class="underline underline-offset-2 hover:text-foreground"
  onclick={open}>{PRIVACY_POLICY_LABEL}</a
>

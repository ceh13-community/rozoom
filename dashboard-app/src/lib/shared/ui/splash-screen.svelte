<script lang="ts">
  import { onMount } from "svelte";

  let visible = $state(true);
  let fadeOut = $state(false);

  onMount(() => {
    const timer = setTimeout(() => {
      fadeOut = true;
      setTimeout(() => {
        visible = false;
      }, 600);
    }, 3000);
    return () => clearTimeout(timer);
  });
</script>

{#if visible}
  <div class="splash" class:fade-out={fadeOut}>
    <div class="splash-content">
      <!-- R + [wheel as O] + ZOOM inline -->
      <div class="logo-row">
        <span class="letter">R</span>

        <svg class="inline-wheel" viewBox="-140 -140 280 280" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="sw" x1="0.2" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stop-color="#c8e4ff"/>
              <stop offset="18%" stop-color="#5daaf6"/>
              <stop offset="55%" stop-color="#1555cc"/>
              <stop offset="100%" stop-color="#0a3098"/>
            </linearGradient>
            <radialGradient id="sh" cx="40%" cy="35%" r="65%">
              <stop offset="0%" stop-color="#4888d8"/>
              <stop offset="100%" stop-color="#0b2880"/>
            </radialGradient>
          </defs>
          <g class="wheel-spin">
            <line x1="0" y1="-110" x2="0" y2="110" stroke="url(#sw)" stroke-width="16" stroke-linecap="round"/>
            <line x1="-110" y1="0" x2="110" y2="0" stroke="url(#sw)" stroke-width="16" stroke-linecap="round"/>
            <line x1="-78" y1="-78" x2="78" y2="78" stroke="url(#sw)" stroke-width="16" stroke-linecap="round"/>
            <line x1="78" y1="-78" x2="-78" y2="78" stroke="url(#sw)" stroke-width="16" stroke-linecap="round"/>
            <circle r="95" fill="none" stroke="url(#sw)" stroke-width="22"/>
            <circle cx="0" cy="-118" r="9" fill="url(#sw)"/>
            <circle cx="0" cy="118" r="9" fill="url(#sw)"/>
            <circle cx="-118" cy="0" r="9" fill="url(#sw)"/>
            <circle cx="118" cy="0" r="9" fill="url(#sw)"/>
            <circle cx="-84" cy="-84" r="9" fill="url(#sw)"/>
            <circle cx="84" cy="-84" r="9" fill="url(#sw)"/>
            <circle cx="-84" cy="84" r="9" fill="url(#sw)"/>
            <circle cx="84" cy="84" r="9" fill="url(#sw)"/>
          </g>
          <!-- Hub (static) -->
          <circle r="38" fill="url(#sh)"/>
          <circle r="38" fill="none" stroke="#6aaaee" stroke-width="2" opacity="0.5"/>
          <circle r="25" fill="#0a1e60"/>
          <text y="5" text-anchor="middle" font-family="'JetBrains Mono',monospace" font-size="15" font-weight="700" fill="#2468d8">k8s</text>
        </svg>

        <span class="letter">ZOOM</span>
      </div>

      <!-- Tag pills -->
      <div class="tags">
        <span class="tag tag-blue">K8s</span>
        <span class="tag tag-green">Linter</span>
        <span class="tag tag-amber">IDE</span>
      </div>

      <!-- Loading dots -->
      <div class="dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    </div>
  </div>
{/if}

<style>
  .splash {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at center, #1c3d70 0%, #0d2140 42%, #040c1a 100%);
    transition: opacity 0.6s ease-out;
  }

  .splash.fade-out {
    opacity: 0;
    pointer-events: none;
  }

  .splash-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    animation: content-appear 0.8s ease-out;
  }

  @keyframes content-appear {
    from {
      opacity: 0;
      transform: scale(0.92) translateY(12px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .logo-row {
    display: flex;
    align-items: center;
    gap: 0;
    filter: drop-shadow(0 4px 24px rgba(10, 48, 180, 0.6));
  }

  .letter {
    font-family: Impact, "Arial Black", sans-serif;
    font-size: 72px;
    font-weight: 900;
    line-height: 1;
    background: linear-gradient(180deg, #d8eeff 0%, #88c4fa 18%, #2578e8 50%, #1040b8 82%, #0820a0 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    user-select: none;
  }

  .inline-wheel {
    width: 68px;
    height: 68px;
    margin: 0 -2px;
    align-self: center;
  }

  .wheel-spin {
    animation: spin 3.5s linear infinite;
    transform-box: fill-box;
    transform-origin: center center;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .tags {
    display: flex;
    gap: 8px;
    margin-top: -4px;
  }

  .tag {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 4px;
  }

  .tag-blue {
    color: #5ea3ff;
    background: rgba(30, 80, 255, 0.1);
    border: 1px solid rgba(59, 135, 255, 0.35);
  }

  .tag-green {
    color: #22d3a0;
    background: rgba(34, 211, 160, 0.08);
    border: 1px solid rgba(34, 211, 160, 0.28);
  }

  .tag-amber {
    color: #f0b040;
    background: rgba(240, 176, 64, 0.08);
    border: 1px solid rgba(240, 176, 64, 0.28);
  }

  .dots {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #3b87ff;
    animation: pulse 1.4s ease-in-out infinite;
  }

  .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes pulse {
    0%, 80%, 100% {
      opacity: 0.3;
      transform: scale(0.8);
    }
    40% {
      opacity: 1;
      transform: scale(1.2);
    }
  }
</style>

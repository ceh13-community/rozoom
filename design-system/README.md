# ROZOOM Design System

> **A Swiss Army Knife for Kubernetes** — design system extracted from the ROZOOM cross-platform fleet IDE.

ROZOOM is an all-in-one fleet IDE for platform engineers and DevOps teams. It bundles every CLI it depends on (kubectl, helm, aws, gcloud), shows up to 100+ clusters on a single dashboard, and combines real-time runtime health signals with configuration risk scoring. Built with Tauri + SvelteKit on desktop, with a mobile companion app in SvelteKit.

The brand voice is **operations-grade, calm, technical**. The visual language is **midnight navy + electric blue**, with a "war-room" CRT alt-theme called **K9s** (amber-on-black, scanlines) for terminal lovers, and a clean **Light** theme for daytime work.

---

## Sources

This system was reverse-engineered from a local codebase mounted as `rozoom-test/`:

- **Desktop app** — `rozoom-test/rozoom/dashboard-app/` (Tauri + SvelteKit + Tailwind + shadcn-svelte/bits-ui)
  - Theme tokens — `src/lib/app/styles/index.css`, `src/lib/app/styles/themes/{light,dark,k9s}.css`
  - Component library — `src/lib/shared/ui/` (button, badge, card, table, dropdown, sheet, tooltip, …)
  - Philosophy — `dashboard-app/PHILOSOPHY.md`
  - Theming guide — `src/lib/shared/theme/THEMING.md`
- **Mobile app** — `rozoom-test/rozoom/mobile-app/` (SvelteKit, plain CSS vars)
  - Tokens — `src/app.css`, `src/lib/styles/themes/{light,dark,k9s}.css`
  - Routes — `src/routes/{+page,alerts/+page,settings/+page,cluster/[id]/+page}.svelte`
- **Reference screenshots** — `rozoom-test/screenshots/` (copied into `assets/screenshots/`)
- **Logo** — `rozoom-test/rozoom/dashboard-app/static/rozoom-{logo,banner}.{svg,png}` (copied into `assets/`)

---

## Index

| File | Purpose |
| --- | --- |
| `README.md` | This file. High-level brand + product context. |
| `colors_and_type.css` | All color + type tokens as CSS variables. Drop-in. |
| `SKILL.md` | Cross-compatible Agent Skill manifest. |
| `assets/` | Logos, banner, favicon, reference screenshots. |
| `fonts/` | (Webfonts loaded from Google Fonts; no local files needed.) |
| `preview/` | Per-token preview cards for the Design System tab. |
| `ui_kits/dashboard/` | React recreation of the desktop fleet IDE. |
| `ui_kits/mobile/` | React recreation of the iOS fleet companion app. |

---

## Products

| Surface | Stack | Primary screens |
| --- | --- | --- |
| **ROZOOM Desktop** | Tauri 2 + SvelteKit + Svelte 5 runes + Tailwind + shadcn-svelte | Cluster Manager, Fleet Dashboard (compact / detailed / k9s table), Pods Workbench, YAML editor, UI Catalog |
| **ROZOOM Mobile** | SvelteKit (web → installable PWA) | Fleet list, Cluster detail, Alerts, Settings |

Both share the **same color tokens** (light + dark + k9s) — desktop uses HSL Tailwind tokens, mobile uses CSS custom properties on `:root[data-theme]`.

---

## Content Fundamentals

### Voice

ROZOOM speaks like a senior SRE writing internal docs: **direct, declarative, no marketing fluff**. Sentences are short. Numbers are exact. Verbs do the work.

- ✅ "12 clusters, 9 healthy"
- ✅ "API latency is high — slow API responses delay scheduling and operations."
- ✅ "metrics-server unavailable"
- ❌ "Unlock the power of cloud-native observability!"
- ❌ "Welcome to your DevOps journey 🚀"

### Casing

- **UI titles**: Title Case for big surface headings ("Available Kubernetes Clusters", "Manage Kubernetes Clusters", "Fleet Control Plane")
- **Section headings**: Title Case ("Detect Cloud Providers", "Detected kubeconfig files")
- **Labels & inline metadata**: Sentence case ("Refresh:", "Backup status:", "Deprecation scan:")
- **Statuses & severities**: UPPERCASE in pill chips when terminal-like (`PAUSED`, `CRITICAL`, `OK`, `RECOMMENDED`); Title case in mobile pills ("Healthy", "Warning", "Critical")
- **CLI fragments**: lowercase, monospace, exact (`kubectl`, `helm`, `kubeconfig`, `CrashLoopBackOff`)

### Person

- **You** addresses the operator: "Connect your first Kubernetes cluster to start monitoring health…"
- **We** is rare and reserved for the team's perspective in PHILOSOPHY.md ("We chose Tauri over Electron…").
- **ROZOOM** as a noun for the app: "ROZOOM copies it into its isolated app data directory."

### Vibe

Think `man kubectl`, `htop`, Stripe Dashboard. **No exclamations, no emoji** in production UI strings. Empty states are reassuring, not cute: *"No clusters connected yet — Connect your first Kubernetes cluster to start monitoring health, running diagnostics, and managing workloads."*

The one place emoji **does** appear is the marketing-adjacent surfaces inside the app (kubeconfig upload card uses 📁 / 📝 / 👋 / 🛠 / 🏷 inline). Treat these as **legacy decoration** — not a system. Prefer Lucide icons.

### Copy examples (verbatim, from the codebase)

- Empty state: *"No clusters connected yet"* / *"No kubeconfig files found in standard locations"*
- Primary CTA: *"Connect a cluster"*, *"Upload kubeconfig"*, *"Scan cloud providers"*, *"Import clusters"*
- Status messages: *"Auto-refresh off (Manual)"*, *"Latest backup is fresh • Completed"*, *"Velero backup CRD is not installed on this cluster"*
- Cluster names: real-world conventions — `prod-eu-west-1`, `staging-us-east`, `dev-digitalocean`, `arn:aws:eks:us-east-1:…`

---

## Visual Foundations

### Color

Three themes, all built on the same semantic token names (`--background`, `--foreground`, `--primary`, `--card`, `--muted`, `--border`, `--ring`, `--destructive`, `--accent`):

| Theme | Vibe | Background | Primary |
| --- | --- | --- | --- |
| **Light** | Calm office. Slight blue-paper warmth. | `hsl(210 100% 99%)` near-white blue | `hsl(219 75% 55%)` royal blue |
| **Dark** *(default)* | Operations center, midnight navy. | `hsl(222 47% 7%)` deep navy | `hsl(217 91% 60%)` electric blue |
| **K9s** | Terminal nostalgia. CRT scanlines, amber-on-black. | `hsl(0 0% 2%)` near-black | `hsl(41 100% 50%)` amber |

Status colors are **fixed across themes** so eyes don't have to retrain: emerald `green` (running, healthy, OK), amber `yellow` (warning, pending), rose `red` (critical, failed, destructive), sky `blue` (info), slate `neutral`. Score buckets: `≥80 healthy`, `≥50 warning`, `<50 critical`.

### Type

- **UI sans (default)**: `Source Sans 3` — `font-weight: 450` body, `500` labels, `600` headings, `700` titles. Loaded from Google Fonts.
- **Mono / k9s body / code / metrics**: `JetBrains Mono` — used for cluster IDs, container counts, terminal output, and the entire k9s theme.
- **Mobile fallback stack**: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui` — preserves native feel on iOS.

Numerics use `font-variant-numeric: tabular-nums` so columns of pod counts / readiness ratios align.

### Spacing & radii

- Base radius: **`0.5rem` (8px)** stored as `--radius`; component scale: `sm = radius - 4px`, `md = radius - 2px`, `lg = radius`, `xl = radius + 4px` (via Tailwind theme).
- Mobile uses larger pill-friendly radii: `--radius: 14px`, `--radius-sm: 10px`.
- Spacing follows Tailwind defaults (4px base): tight clusters (`gap-1`/`gap-2`) for chip rows, generous (`gap-4`/`gap-6`) for card grids.

### Backgrounds

- **Desktop shells** use a soft **radial-on-linear gradient**, not a flat color. Light: `radial-gradient(circle at top left, sky-50, transparent 38%) over linear-gradient(180deg, white-blue → mist)`. Dark: `radial(navy-glow) over linear(midnight → ink)`. K9s: pure linear black.
- **Card surfaces** layer a subtle inner-light gradient (`inset 0 1px 0 rgba(255,255,255,…)`) on top of a 96–92% opaque body color over the shell — gives a faint "lit panel" depth without skeuomorphism.
- **No full-bleed photography, no illustrations.** The brand icon (gear/wheel) is the only decorative element used at scale.
- **K9s scanlines**: a fixed `::after` overlay with `repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.03) 2px 4px)` — pure CRT nostalgia.

### Borders & shadows

Borders are **always semantic** (`hsl(var(--border))`, `0.5–1px`), never colored — color comes from accent fills. Cards stack two effects:

```
inset 0 1px 0 rgba(255,255,255,0.16)        ← top inner-light highlight
0 24px 40px hsl(218 57% 52% / 0.16)         ← outer ambient drop (light)
0 4px 16px hsl(222 47% 3% / 0.30)           ← outer ambient drop (dark)
```

K9s replaces shadows with **cyan-rim glows**: `inset 0 0 0 1px hsl(191 88% 44% / 0.14)` and amber `text-shadow` on headings.

### Animations

Restrained. **Tailwind defaults plus 3 custom keyframes**:

- `accordion-down/up` — `0.2s ease-out` height tween
- `caret-blink` — 1.25s opacity loop
- `dot-pulse` — loading dots, `1s ease-in-out infinite`

Mobile adds page-transition `fadeIn`: opacity 0 → 1 with a 6px upward translate over 0.2s. **No bounces, no springs, no parallax.**

### Hover & press

- **Hover**: most interactive elements darken or shift to a lighter tint via `hover:bg-primary/90`, `hover:bg-secondary/80`, `hover:bg-accent`. Menu items get a 1px inset border ring of the brand color in active state.
- **Press (mobile)**: `transform: scale(0.98)` on `.card:active`; FAB does `scale(0.9)`. Desktop uses no scale — just instant color change.
- **Focus**: 1px focus ring at `--ring` color, no outline.

### Transparency & blur

Sticky headers and tab bars use `backdrop-filter: blur(20px)` over a 95% surface alpha — only when the browser supports it (`supports-[backdrop-filter]`). Used **only** for sticky UI (table headers, mobile tab bar, sticky filter bars). Not used decoratively.

### Cards

The atom of the system. `rounded-xl border bg-card shadow` (Tailwind) or `border-radius: var(--radius); border: 1px solid; background: gradient` (mobile). On status, the card's **header strip** receives the status color (red=critical, amber=warning, green=ok), not the whole card.

### Layout rules

- Desktop sidebar is a **fixed gradient rail**, ~64px collapsed, slides up to ~240px expanded.
- Pages have **a single H1**; sub-sections are `<section class="rounded-xl">` panels with their own padding.
- Mobile pages use a **62px bottom tab bar** with safe-area padding, never a top nav. FAB at bottom-right above the tab bar.
- Tables and lists are **flush to card edges** with sticky headers; row spacing is dense (10–12px vertical).

---

## Iconography

ROZOOM is a **Lucide-only product**. The desktop's `src/lib/shared/ui/icons/index.ts` re-exports ~50 named Lucide icons — anything outside that list isn't part of the system.

- **Library**: [Lucide](https://lucide.dev) — outline / 1.5–2px stroke / 24×24 viewbox / rounded line caps. Linked from CDN (`https://unpkg.com/lucide@latest`) in this design system; production uses `@lucide/svelte` package.
- **Sizing**: 16px in chips & inline buttons, 20px in menu rails, 22px in mobile tab bar, 24px on splash. Buttons set `[&_svg]:size-4` (16px) by default.
- **No PNG icons.** No icon font.
- **Emoji**: shows up in *one* legacy surface — the kubeconfig-upload card uses 📁 📝 👋 🛠 🏷 inline. Treat as legacy. **New screens use Lucide only.**
- **Unicode chars** (•, ✓, ⌘, →) appear in inline notes and shortcut hints.
- **Brand mark**: the ROZOOM logo's central glyph is a stylized gear/wheel-of-spokes inside a hub — riffing on the K8s wheel without copying it. Kept in `assets/rozoom-logo.svg` (full lockup) and `assets/favicon.png`.

---

*Last updated: May 2026 · Sources: ROZOOM dashboard-app v0.x, mobile-app v0.1.0*

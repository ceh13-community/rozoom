---
name: rozoom-design-system
description: ROZOOM is a cross-platform Kubernetes fleet IDE (Tauri + SvelteKit desktop, SvelteKit mobile companion). Operations-grade aesthetic — midnight navy + electric blue, with optional CRT-amber "K9s" theme. Use this skill when building UI for ROZOOM, designing for k8s/DevOps tooling that wants the same vibe, or referencing ROZOOM patterns.
---

# ROZOOM Design System

> **Tagline**: A swiss army knife for Kubernetes.

A calm, technical operations-IDE aesthetic for fleet management surfaces. Three drop-in themes share the same semantic tokens.

## What's in this skill

| File | Use when |
| --- | --- |
| `README.md` | Full brand + product + visual reference. Read first. |
| `colors_and_type.css` | Drop-in CSS — fonts, color tokens, radii, motion, base type. |
| `assets/rozoom-logo.svg` · `rozoom-logo.png` · `rozoom-banner.svg` · `favicon.png` | Brand marks. Logo works on light & dark surfaces (built-in radial-glow background). |
| `assets/screenshots/` | Reference screenshots of the real desktop app (cluster manager, dashboard, compact/detailed list, dev catalog). Use as visual North Star. |
| `preview/{type,colors,spacing,components,brand}.html` | Per-token preview cards. |
| `ui_kits/dashboard/Fleet Dashboard.html` | Desktop fleet IDE recreation — sidebar + stats + cluster grid. |
| `ui_kits/mobile/Mobile App.html` | iOS mobile companion — fleet list + cluster detail. |

## Quick start

```html
<link rel="stylesheet" href="colors_and_type.css" />
<html data-theme="dark">  <!-- or "light", "k9s" -->
```

Then use semantic tokens via `hsl(var(--background))`, `hsl(var(--foreground))`, `hsl(var(--primary))`, `hsl(var(--card))`, `hsl(var(--border))`, `hsl(var(--status-ok|warn|bad|info))`, etc. Body picks up `var(--shell-bg)` (radial-on-linear gradient) automatically; cards use `box-shadow: var(--card-shadow)`.

## House rules (most-violated, most-important)

1. **Three themes, one token set.** Never branch on theme — set `data-theme` and let tokens flow. Status colors stay consistent across themes so eyes don't retrain.
2. **Lucide icons only.** Outline, 1.5–2px stroke, 16px in chips, 22px in mobile tabs. No emoji in production strings (one legacy exception: kubeconfig upload card).
3. **Fonts.** Body & UI: **Source Sans 3** at weight 450/500/600/700. Code, cluster IDs, container counts, k9s body: **JetBrains Mono**. Numerics use `tabular-nums`.
4. **Voice.** Senior-SRE-internal-doc — direct, declarative, exact numbers. No marketing fluff, no exclamations, no rocket emoji.
5. **Cards** are `rounded-xl border bg-card shadow` with `var(--card-shadow)` (inner-light highlight + ambient outer drop). Status indication goes on a strip/pill, never the whole card body.
6. **Score buckets**: ≥80 healthy (green), ≥50 warning (amber), <50 critical (red).
7. **K9s theme** is amber-on-black, JetBrains Mono throughout, with CRT scanlines (`body::after` repeating-linear-gradient). Reserved for terminal-loving power users.

## When NOT to use this system

- You're designing a consumer brand. ROZOOM is operations-grade; this won't feel right for a marketplace, social app, or DTC product.
- You need illustrations or photography. The system is icon + type + token only — placeholders are better than off-brand imagery.

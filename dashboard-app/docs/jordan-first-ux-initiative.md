# Jordan-First UX Initiative

> Target persona: **Jordan Rivera** - DevOps engineer managing 8 clusters, keyboard-first workflow.
> Goal: reduce clicks-to-action, add keyboard navigation, make ROZOOM feel like a power tool.

## PR Tracker

| #   | PR                                                                                                 | Branch                     | Status | Depends on |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------- | ------ | ---------- |
| 1   | [#100](https://github.com/ceh13-community/svelte-dashboard/pull/100) Scale for Deployments         | `feat/quick-actions-scale` | Open   | -          |
| 2   | [#101](https://github.com/ceh13-community/svelte-dashboard/pull/101) Keyboard Manager              | `feat/keyboard-manager`    | Open   | -          |
| 3   | [#102](https://github.com/ceh13-community/svelte-dashboard/pull/102) ScaleDialog                   | `feat/scale-dialog`        | Open   | #100       |
| 4   | [#103](https://github.com/ceh13-community/svelte-dashboard/pull/103) Command Palette (Cmd+K)       | `feat/command-palette`     | Open   | #101       |
| 5   | [#104](https://github.com/ceh13-community/svelte-dashboard/pull/104) Keyboard shortcuts + vim goto | `feat/keyboard-shortcuts`  | Open   | #103       |
| 6   | [#105](https://github.com/ceh13-community/svelte-dashboard/pull/105) Table j/k navigation          | `feat/table-keyboard-nav`  | Open   | #104       |

## Architecture

### Keyboard Manager (`shared/lib/keyboard-manager.ts`)

- Singleton handling all keyboard shortcuts globally
- Supports: simple keys (`/`), modifier combos (`mod+k`), chord sequences (`g d`)
- Overlay escape stack (LIFO) for dialogs/sheets
- Input focus guard: single-key shortcuts suppressed in text fields
- `mod` = Meta on macOS, Ctrl on Linux/Windows

### Command Palette (`features/command-palette/`)

- VS Code-style Cmd+K overlay with fuzzy search
- Command sources: cluster navigation, workload pages, quick actions
- bits-ui Dialog + custom filtered list

### Quick Actions

- Scale: Deployments, StatefulSets, ReplicaSets (via ScaleDialog)
- Restart: rollout restart (already exists)
- Cordon/Uncordon/Drain: nodes (already exists)

### Keyboard Shortcuts

| Shortcut           | Action                    |
| ------------------ | ------------------------- |
| `Cmd+K` / `Ctrl+K` | Open command palette      |
| `Escape`           | Close topmost overlay     |
| `/`                | Focus workload search     |
| `g d`              | Go to Deployments         |
| `g p`              | Go to Pods                |
| `g s`              | Go to StatefulSets        |
| `g n`              | Go to Nodes               |
| `g j`              | Go to Jobs                |
| `g c`              | Go to ConfigMaps          |
| `g i`              | Go to Ingresses           |
| `j` / `k`          | Navigate table rows       |
| `Enter`            | Open selected row details |

## Design Decisions

1. **bits-ui Dialog for command palette** - consistent with existing Sheet component
2. **Centralized keyboard manager** - prevents shortcut conflicts between components
3. **ScaleDialog as shared primitive** - replaces `window.prompt` across all scalable resources
4. **Command registry in features/** - business logic, not shared UI
5. **Table j/k as opt-in hook** - keeps shared data-table untouched for non-keyboard tables

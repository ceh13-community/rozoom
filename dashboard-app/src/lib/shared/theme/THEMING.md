# Theming Guide

This app uses a registry-driven theme system. To add a new theme, update one registry entry and then layer CSS tokens and component overrides on top.

## 1. Register the theme

Add a new item to `src/lib/shared/theme/theme.ts` inside `THEME_DEFINITIONS`.

Required fields:

- `id`: stable storage key and runtime identifier
- `label`: UI label shown in the theme switcher
- `baseMode`: `"light"` or `"dark"` for `mode-watcher`
- `rootClassName`: optional root HTML class for theme-specific CSS

Example:

```ts
{
  id: "solarized",
  label: "Solarized",
  baseMode: "dark",
  rootClassName: "solarized",
}
```

The rest of the theme module updates automatically:

- switcher order
- labels
- next-theme cycling
- local storage resolution
- initial bootstrap script

## 2. Add CSS tokens

Define the theme in `src/lib/app/styles/index.css`.

- Put design tokens in `@layer base`
- Use the `rootClassName` as the selector
- Prefer semantic tokens like `--background`, `--primary`, `--border`

Example:

```css
.solarized {
  --background: 193 100% 11%;
  --foreground: 44 87% 94%;
  --primary: 45 100% 51%;
  --border: 192 81% 32%;
}
```

## 3. Add scoped component overrides

If a theme needs a stronger visual identity, add targeted component overrides in:

- `src/lib/app/styles/themes/light.css`
- `src/lib/app/styles/themes/dark.css`
- `src/lib/app/styles/themes/k9s.css`

or create a new file in that folder for a new theme and import it from `index.css`.

Guidelines:

- Prefer semantic wrapper classes such as `.dashboard-shell` or `.cluster-sticky-shell`
- Avoid global utility overrides unless they are intentionally theme-wide
- Scope to a theme root class, for example `.k9s .dashboard-shell`

## 4. Verify the contract

Run:

```bash
npx svelte-check --tsconfig ./tsconfig.json
npm exec vitest run src/lib/shared/theme/theme.test.ts
```

Update `src/lib/shared/theme/theme.test.ts` if the registry contract changes.

## Notes for contributors

- Do not add theme-specific branching to random components when a registry entry or scoped CSS override will do.
- Prefer adding a semantic wrapper class first, then styling that class per theme.
- If a theme needs a custom font, add it in `src/routes/+layout.svelte` and scope usage in `index.css`.

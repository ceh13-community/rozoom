## Summary

Brief description of changes.

## Section

Which app section does this PR affect?

## Type

- [ ] `feat` - New feature
- [ ] `fix` - Bug fix
- [ ] `refactor` - Code improvement (no behavior change)
- [ ] `docs` - Documentation
- [ ] `test` - Tests

## Checklist

- [ ] Tests added/updated for new functionality
- [ ] `pnpm vitest` passes (all tests green)
- [ ] `pnpm format` applied
- [ ] `pnpm run check` passes (TypeScript + Svelte)
- [ ] Relevant docs updated in `dashboard-app/docs/`
- [ ] Uses existing shared components where applicable
- [ ] Action menus follow section labels pattern (Manifest/Diagnostics/Dangerous)
- [ ] Notifications use `ActionNotificationBar` (not ad-hoc Alert.Root)

## UX acceptance

Required for any PR that changes a screen, a menu entry, a dialog or a user-visible string.
Each line is yes/no - there is no "partly". A box left unchecked needs one line below saying
which rule fails and why the PR still goes in.

- [ ] 1. Purpose of the screen is clear from a screenshot alone in 30 seconds, no manual needed
- [ ] 2. Routine cluster operation stays within 3 clicks of the entry point (wizards are counted in steps, not clicks)
- [ ] 3. No raw jargon, class name or error code on screen without a plain-language equivalent next to it
- [ ] 4. Every state carries a non-color indicator (icon or label) and text contrast is at least 4.5:1
- [ ] 5. Clickable and focusable elements have visible hover and focus states, tab order has no jumps
- [ ] 6. Every error state names the next action in plain language, zero raw stderr or stack traces
- [ ] 7. Visible response under 100ms, or a visible progress indicator for anything over one second

Not applicable to PRs with no user-visible surface (CI, build, internal refactor) - say so in the Summary.

## Screenshots

If UI changes, add before/after screenshots.

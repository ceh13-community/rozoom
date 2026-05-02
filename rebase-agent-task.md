# Task: Rebase 18 PRs onto main in ceh13-community/rozoom

## Context
- Repo: /tmp/rozoom-rebase-1777715601 (already cloned)
- Remote: origin = git@github.com:ceh13-community/rozoom.git
- Git user: name="U_DAW", email="udawpk@gmail.com"
- All PRs branch from commit 28d9687 (PR #63)
- Conflicts come from PR #64 (feat/persist-dashboard-card-state) and PR #91 (feat/ux-quick-wins-e4) which were merged to main after
- Branch protection is OFF - can merge without review

## Goal
For each PR below: fetch branch → checkout → rebase on origin/main → resolve conflicts → push --force-with-lease → merge via `gh pr merge N --merge --repo ceh13-community/rozoom`

## Conflict Resolution Strategy
When resolving conflicts:
1. ALWAYS keep new code added by main (HEAD side) - e.g., sectionOpen/toggleSection/saveClusterCardSections from #64
2. ALSO apply the PR's actual changes (commit side) - e.g., if PR removes DEFAULT_REFRESH_INTERVAL_MINUTES, keep that removal
3. Both sides' changes should be merged - never blindly `git checkout --ours` or `--theirs`
4. After resolving: `git add <file>` then `git rebase --continue`

## PRs in ORDER (important - process sequentially)
1. #65 - feat/sentry-ignore-hmr-noise
2. #66 - feat/connect-wizard-autoimport-paste-recency
3. #67 - refactor/providers-scoped-scan-cta
4. #68 - fix/cluster-manager-cta-first-run
5. #69 - feat/cluster-manager-refresh-cta
6. #70 - fix/config-diagnostics-surface-error
7. #71 - fix/cluster-card-auth-error-primary-alert
8. #72 - feat/cluster-add-auto-initial-check
9. #73 - fix/cluster-detailed-card-status-row-layout
10. #74 - fix/cluster-card-local-attempt-timestamp
11. #75 - fix/cluster-card-refresh-ts-on-error
12. #76 - fix/cluster-card-refresh-hint-states
13. #77 - feat/cluster-card-refresh-visibility
14. #78 - feat/helm-catalog-networking-traefik-f5
15. #79 - fix/helm-js-timeout-budget
16. #80 - fix/helm-catalog-chart-defaults
17. #81 - fix/helm-catalog-preset-console
18. #90 - feat/helm-releases-command-console

## For each PR, run:
```bash
git config user.email "udawpk@gmail.com"
git config user.name "U_DAW"
git fetch origin <branch>
git checkout -B <branch> origin/<branch>
git rebase origin/main
# If conflict: resolve manually, git add, git rebase --continue
git push --force-with-lease origin <branch>
gh pr merge <N> --merge --repo ceh13-community/rozoom
```

## After finishing ALL PRs, run:
```
openclaw system event --text "Rebase complete: all 18 PRs processed. Check results." --mode now
```

## Important
- Work in /tmp/rozoom-rebase-1777715601
- Export GIT_EDITOR=true to avoid editor popups during rebase
- If a PR fails after 2 attempts, log the error and move on - don't block
- Keep a log of what succeeded/failed

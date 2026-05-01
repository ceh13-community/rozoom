#!/bin/bash
set -e

REPO_DIR="/tmp/rozoom-rebase-1777715601"
cd "$REPO_DIR"

git config user.email "udawpk@gmail.com"
git config user.name "U_DAW"

# Configure git to handle rebases without editor
export GIT_EDITOR=true
export GIT_MERGE_AUTOEDIT=no

RESULTS=()

rebase_pr() {
  local PR_NUM=$1
  local BRANCH=$2
  
  echo ""
  echo "=== PR #$PR_NUM: $BRANCH ==="
  
  git fetch origin "$BRANCH" 2>/dev/null || {
    echo "SKIP: branch $BRANCH not found"
    RESULTS+=("⚠️  #$PR_NUM — branch not found")
    return
  }
  
  git checkout -B "$BRANCH" "origin/$BRANCH" 2>/dev/null
  
  # Try rebase
  if git rebase origin/main 2>&1; then
    echo "✅ Rebase clean, pushing..."
    git push --force-with-lease origin "$BRANCH" 2>&1
    
    # Merge via gh
    if gh pr merge "$PR_NUM" --merge --repo ceh13-community/rozoom 2>&1; then
      RESULTS+=("✅ #$PR_NUM — rebased + merged")
    else
      RESULTS+=("⚠️  #$PR_NUM — rebased+pushed but merge failed")
    fi
  else
    echo "❌ Conflict on PR #$PR_NUM"
    git rebase --abort 2>/dev/null || true
    RESULTS+=("❌ #$PR_NUM ($BRANCH) — CONFLICT, needs manual resolve")
  fi
}

# Run in order
rebase_pr 65 "feat/sentry-ignore-hmr-noise"
rebase_pr 66 "feat/connect-wizard-autoimport-paste-recency"
rebase_pr 67 "refactor/providers-scoped-scan-cta"
rebase_pr 68 "fix/cluster-manager-cta-first-run"
rebase_pr 69 "feat/cluster-manager-refresh-cta"
rebase_pr 70 "fix/config-diagnostics-surface-error"
rebase_pr 71 "fix/cluster-card-auth-error-primary-alert"
rebase_pr 72 "feat/cluster-add-auto-initial-check"
rebase_pr 73 "fix/cluster-detailed-card-status-row-layout"
rebase_pr 74 "fix/cluster-card-local-attempt-timestamp"
rebase_pr 75 "fix/cluster-card-refresh-ts-on-error"
rebase_pr 76 "fix/cluster-card-refresh-hint-states"
rebase_pr 77 "feat/cluster-card-refresh-visibility"
rebase_pr 78 "feat/helm-catalog-networking-traefik-f5"
rebase_pr 79 "fix/helm-js-timeout-budget"
rebase_pr 80 "fix/helm-catalog-chart-defaults"
rebase_pr 81 "fix/helm-catalog-preset-console"
rebase_pr 90 "feat/helm-releases-command-console"

echo ""
echo "========== SUMMARY =========="
for r in "${RESULTS[@]}"; do
  echo "$r"
done

# Notify when done
openclaw system event --text "Rebase done: ${#RESULTS[@]} PRs processed. Check results." --mode now 2>/dev/null || true

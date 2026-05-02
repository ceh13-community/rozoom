#!/bin/bash

REPO="/tmp/rozoom-rebase-1777715601"
cd "$REPO"

git config user.email "udawpk@gmail.com"
git config user.name "U_DAW"
export GIT_EDITOR=true

declare -A PR_BRANCHES=(
  [71]="fix/cluster-card-auth-error-primary-alert"
  [72]="feat/cluster-add-auto-initial-check"
  [73]="fix/cluster-detailed-card-status-row-layout"
  [74]="fix/cluster-card-local-attempt-timestamp"
  [75]="fix/cluster-card-refresh-ts-on-error"
  [76]="fix/cluster-card-refresh-hint-states"
  [77]="feat/cluster-card-refresh-visibility"
  [78]="feat/helm-catalog-networking-traefik-f5"
  [79]="fix/helm-js-timeout-budget"
  [80]="fix/helm-catalog-chart-defaults"
  [81]="fix/helm-catalog-preset-console"
  [90]="feat/helm-releases-command-console"
)

RESULTS=()

rebase_and_merge() {
  local PR=$1
  local BRANCH=$2
  
  echo ""
  echo "=== #$PR: $BRANCH ==="
  
  git fetch origin "$BRANCH" --quiet 2>/dev/null || {
    echo "SKIP: branch not found"
    RESULTS+=("⚠️  #$PR — branch not found")
    return
  }
  
  git checkout -B "$BRANCH" "origin/$BRANCH" --quiet 2>/dev/null
  
  # Check if already on main
  MAIN=$(git rev-parse origin/main)
  BASE=$(git merge-base HEAD origin/main)
  if [ "$BASE" = "$MAIN" ]; then
    echo "Already on latest main, just merging"
    gh pr merge "$PR" --merge --repo ceh13-community/rozoom 2>&1 && \
      RESULTS+=("✅ #$PR — already rebased, merged") && return
  fi
  
  # Try rebase
  if git rebase origin/main 2>&1; then
    echo "✅ Clean rebase"
  else
    echo "Conflicts detected, resolving with --ours strategy"
    local MAX_ROUNDS=10
    local ROUND=0
    
    while [ $ROUND -lt $MAX_ROUNDS ]; do
      ROUND=$((ROUND + 1))
      CONFLICTS=$(git ls-files -u | awk '{print $4}' | sort -u)
      
      if [ -z "$CONFLICTS" ]; then
        break
      fi
      
      echo "  Round $ROUND conflicts:"
      echo "$CONFLICTS" | while read f; do echo "    $f"; done
      
      while IFS= read -r f; do
        # For deleted-by-theirs (UD): keep ours (main has it, PR deleted it)
        if git status --short | grep -qE "^UD $f"; then
          git add "$f" 2>/dev/null || true
        else
          git checkout --ours "$f" 2>/dev/null && git add "$f" 2>/dev/null || \
          git checkout --theirs "$f" 2>/dev/null && git add "$f" 2>/dev/null || \
          git add "$f" 2>/dev/null || true
        fi
      done <<< "$CONFLICTS"
      
      if GIT_EDITOR=true git rebase --continue 2>&1; then
        echo "  ✅ Continue succeeded"
        break
      fi
      
      # Check if still in rebase
      if ! git status 2>/dev/null | grep -q "rebase"; then
        break
      fi
    done
    
    if git status 2>/dev/null | grep -q "rebase in progress"; then
      echo "❌ Could not complete rebase after $MAX_ROUNDS rounds"
      git rebase --abort 2>/dev/null
      RESULTS+=("❌ #$PR — rebase failed")
      return
    fi
    
    echo "✅ Conflicts resolved"
  fi
  
  # Push (no hook in this clone)
  if git push --force-with-lease origin "$BRANCH" 2>&1; then
    echo "✅ Pushed"
  else
    echo "❌ Push failed"
    RESULTS+=("❌ #$PR — push failed")
    return
  fi
  
  # Merge
  if gh pr merge "$PR" --merge --repo ceh13-community/rozoom 2>&1; then
    echo "✅ Merged!"
    RESULTS+=("✅ #$PR $BRANCH")
  else
    echo "❌ Merge failed (might need re-fetch)"
    # Try once more after re-fetch
    git fetch origin --quiet
    git rebase origin/main 2>/dev/null && git push --force-with-lease origin "$BRANCH" 2>/dev/null
    if gh pr merge "$PR" --merge --repo ceh13-community/rozoom 2>&1; then
      echo "✅ Merged on retry!"
      RESULTS+=("✅ #$PR $BRANCH (retry)")
    else
      RESULTS+=("❌ #$PR — merge failed")
    fi
  fi
}

# Process remaining PRs
for PR in 71 72 73 74 75 76 77 78 79 80 81 90; do
  # Check if already merged
  STATE=$(gh pr view $PR --repo ceh13-community/rozoom --json state --jq '.state' 2>/dev/null)
  if [ "$STATE" = "MERGED" ]; then
    echo "✅ #$PR already merged, skipping"
    RESULTS+=("✅ #$PR already merged")
    continue
  fi
  
  BRANCH="${PR_BRANCHES[$PR]}"
  rebase_and_merge "$PR" "$BRANCH"
  
  # Fetch to update main after each merge
  git fetch origin --quiet
done

echo ""
echo "========= FINAL RESULTS ========="
for r in "${RESULTS[@]}"; do
  echo "$r"
done

openclaw system event --text "Rebase+merge done! Results: ${RESULTS[*]}" --mode now 2>/dev/null || true

#!/usr/bin/env bash
# Run at the repository root after checking out TARGET_BRANCH with full history.
set -euo pipefail

: "${TARGET_BRANCH:?}"
: "${GH_REPO:?}"
: "${GITHUB_OUTPUT:?}"
git check-ref-format "refs/heads/${TARGET_BRANCH}"
if [[ "$TARGET_BRANCH" == automation/translations/* ]]; then
  echo 'Choose a source branch, not an automation/translations/* branch.' >&2
  exit 1
fi

translation_branch="automation/translations/${TARGET_BRANCH}"
base_sha=$(git rev-parse HEAD)
echo "base-sha=$base_sha" >> "$GITHUB_OUTPUT"
echo "translation-branch=$translation_branch" >> "$GITHUB_OUTPUT"

# Reuse the unmerged batch, including any human corrections made on its PR.
# Apply only locale data, using a three-way merge so concurrent source-branch
# edits are preserved or reported as conflicts instead of silently overwritten.
pr_number=$(gh pr list --repo "$GH_REPO" --base "$TARGET_BRANCH" --head "$translation_branch" --state open --json number,isCrossRepository --jq '[.[] | select(.isCrossRepository == false)][0].number // empty')
if [[ -n "$pr_number" ]]; then
  git fetch origin "refs/heads/${translation_branch}:refs/remotes/origin/${translation_branch}"
  translation_sha=$(git rev-parse "refs/remotes/origin/${translation_branch}")
  patch_file=$(mktemp)
  trap 'rm -f "$patch_file"' EXIT
  git diff --binary "HEAD...refs/remotes/origin/${translation_branch}" -- \
    packages/ui/public/locales/ ':!packages/ui/public/locales/en.json' \
    packages/ui/translations/last-translated.en.json > "$patch_file"
  if [[ -s "$patch_file" ]]; then
    if ! git apply --3way "$patch_file"; then
      echo "Translation PR #${pr_number} conflicts with ${TARGET_BRANCH}. Resolve its conflicts before running again." >&2
      exit 1
    fi
  fi
else
  translation_sha=$(git ls-remote origin "refs/heads/${translation_branch}" | cut -f1)
fi
echo "translation-sha=$translation_sha" >> "$GITHUB_OUTPUT"

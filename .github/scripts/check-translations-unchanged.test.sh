#!/usr/bin/env bash
# Exercise the check against pushes from a second clone in disposable Git repositories.
set -euo pipefail
script=$(cd "$(dirname "$0")" && pwd)/check-translations-unchanged.sh
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME='Translation test'
export GIT_AUTHOR_EMAIL='translations@example.invalid'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

git init --quiet --bare "$test_dir/origin.git"
git init --quiet -b staging "$test_dir/work"
cd "$test_dir/work"
git remote add origin "$test_dir/origin.git"
mkdir -p packages/ui/public/locales packages/ui/translations packages/ui/src
printf '{"message":"English"}\n' > packages/ui/public/locales/en.json
printf '{"message":"English"}\n' > packages/ui/translations/last-translated.en.json
printf '{"message":"Translation"}\n' > packages/ui/public/locales/de.json
printf 'Source\n' > packages/ui/src/app.tsx
git add .
git commit --quiet -m 'Source branch before a batch'
git push --quiet origin staging
git clone --quiet --branch staging "$test_dir/origin.git" "$test_dir/other"

export TARGET_BRANCH=staging
export TRANSLATION_BRANCH=automation/translations/staging
export TRANSLATION_SHA=
BASE_SHA=$(git rev-parse HEAD)
export BASE_SHA

# Model a commit reaching the target branch while the batch generates.
push_change() {
  printf '%s\n' "$2" > "$test_dir/other/$1"
  git -C "$test_dir/other" add .
  git -C "$test_dir/other" commit --quiet -m "Change $1"
  git -C "$test_dir/other" push --quiet origin staging
}
expect_failure() {
  if bash "$script" > "$test_dir/log" 2>&1; then
    echo "Expected the check to fail: $1" >&2
    exit 1
  fi
  grep -q "$1" "$test_dir/log"
}
# Model the rerun that follows a failed check: it starts from the new target head.
start_from_target() {
  git pull --quiet origin staging
  BASE_SHA=$(git rev-parse HEAD)
}

# Nothing moved, and the translation branch doesn't exist yet.
bash "$script"

# Unrelated commits and English edits must not discard a finished batch.
push_change packages/ui/src/app.tsx 'Changed source'
bash "$script"
push_change packages/ui/public/locales/en.json '{"message":"New English"}'
bash "$script"
# The check must not move the remote-tracking branch the PR step resets to.
test "$(git rev-parse origin/staging)" = "$BASE_SHA"

# A translation or snapshot changed on the target branch must fail.
push_change packages/ui/public/locales/de.json '{"message":"Human correction"}'
expect_failure 'Translations on staging changed during generation'
start_from_target
bash "$script"
push_change packages/ui/translations/last-translated.en.json '{"message":"New English"}'
expect_failure 'Translations on staging changed during generation'
start_from_target
bash "$script"

# A translation branch that appeared or moved during generation must fail.
git push --quiet origin HEAD:refs/heads/automation/translations/staging
expect_failure 'The translation branch changed during generation'
TRANSLATION_SHA=$(git rev-parse HEAD)
bash "$script"
push_change packages/ui/src/app.tsx 'Reviewer correction'
git -C "$test_dir/other" push --quiet origin HEAD:refs/heads/automation/translations/staging
expect_failure 'The translation branch changed during generation'
printf 'Translation publish check tests passed.\n'

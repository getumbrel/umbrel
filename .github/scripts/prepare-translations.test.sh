#!/usr/bin/env bash
# Exercise real three-way merges in disposable Git repositories; only gh is stubbed.
set -euo pipefail
script=$(cd "$(dirname "$0")" && pwd)/prepare-translations.sh
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
mkdir -p packages/ui/public/locales packages/ui/translations "$test_dir/bin"
cat > "$test_dir/bin/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${TEST_OPEN_PR:-false}" == true ]]; then echo 123; fi
GH
chmod +x "$test_dir/bin/gh"
export PATH="$test_dir/bin:$PATH"
export TARGET_BRANCH=staging
export GH_REPO=example/umbrel
export GITHUB_OUTPUT="$test_dir/output"

cat > packages/ui/public/locales/en.json <<'JSON'
{"message":"New English", "stable":"Stable"}
JSON
cat > packages/ui/translations/last-translated.en.json <<'JSON'
{"message":"Old English", "stable":"Stable"}
JSON
cat > packages/ui/public/locales/de.json <<'JSON'
{
  "message": "Old translation",
  "a": "a",
  "b": "b",
  "c": "c",
  "d": "d",
  "e": "e",
  "f": "f",
  "g": "g",
  "stable": "Stable translation"
}
JSON
git add .
git commit --quiet -m 'Source branch before a batch'
git push --quiet origin staging
initial_sha=$(git rev-parse HEAD)

# First run has no open PR and must not change any file.
bash "$script"
test -z "$(git status --porcelain)"
grep -q "base-sha=$initial_sha" "$GITHUB_OUTPUT"
grep -q 'translation-branch=automation/translations/staging' "$GITHUB_OUTPUT"

# Model a completed, unmerged batch plus a reviewer correction on its branch.
git checkout --quiet -b automation/translations/staging
sed 's/Old translation/Reviewed translation/' packages/ui/public/locales/de.json > "$test_dir/locale"
cp "$test_dir/locale" packages/ui/public/locales/de.json
cp packages/ui/public/locales/en.json packages/ui/translations/last-translated.en.json
printf 'Unrelated PR change\n' > unrelated.txt
# An English edit on the automation branch must never overwrite source English.
printf '{"message":"Do not import this"}\n' > packages/ui/public/locales/en.json
git add .
git commit --quiet -m 'Translate and review'
git push --quiet origin automation/translations/staging
git checkout --quiet staging

# Meanwhile the target branch received an independent human locale correction.
sed 's/Stable translation/Target human correction/' packages/ui/public/locales/de.json > "$test_dir/locale"
cp "$test_dir/locale" packages/ui/public/locales/de.json
git add .
git commit --quiet -m 'Independent correction'
git push --quiet origin staging
source_sha=$(git rev-parse HEAD)
export TEST_OPEN_PR=true
for attempt in 1 2; do
  git reset --quiet --hard "$source_sha"
  bash "$script"
  grep -q 'Reviewed translation' packages/ui/public/locales/de.json
  grep -q 'Target human correction' packages/ui/public/locales/de.json
  grep -q 'New English' packages/ui/translations/last-translated.en.json
  git diff --exit-code HEAD -- packages/ui/public/locales/en.json
  test ! -e unrelated.txt
done

# Without an open PR, ignore the leftover automation branch.
git reset --quiet --hard "$source_sha"
export TEST_OPEN_PR=false
bash "$script"
test -z "$(git status --porcelain)"

# Concurrent edits to the same translation must fail rather than overwrite.
sed 's/Old translation/Conflicting correction/' packages/ui/public/locales/de.json > "$test_dir/locale"
cp "$test_dir/locale" packages/ui/public/locales/de.json
git add .
git commit --quiet -m 'Conflicting correction'
export TEST_OPEN_PR=true
if bash "$script" > "$test_dir/conflict-log" 2>&1; then
  echo 'Expected a conflict to fail preparation' >&2
  exit 1
fi
grep -q 'Resolve its conflicts' "$test_dir/conflict-log"

# Invalid branch names must fail before gh or git fetch.
if TARGET_BRANCH='staging..bad' bash "$script" > /dev/null 2>&1; then exit 1; fi
if TARGET_BRANCH='automation/translations/staging' bash "$script" > /dev/null 2>&1; then exit 1; fi
printf 'Translation PR preparation tests passed.\n'

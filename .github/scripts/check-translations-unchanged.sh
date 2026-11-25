#!/usr/bin/env bash
# Run at the repository root after generating a batch and before publishing it.
set -euo pipefail

: "${TARGET_BRANCH:?}"
: "${BASE_SHA:?}"
: "${TRANSLATION_BRANCH:?}"
# Empty when the translation branch doesn't exist yet.
: "${TRANSLATION_SHA?}"

# The PR is built on BASE_SHA, so commits that reached the target branch during
# generation merge like any others. English edits are fine too: the snapshot
# records the English this batch translated, so the next run picks up the rest.
# Only translations changed on the target branch could conflict with this batch.
current_sha=$(git ls-remote --exit-code origin "refs/heads/${TARGET_BRANCH}" | cut -f1)
if [[ "$current_sha" != "$BASE_SHA" ]]; then
  git fetch --quiet --no-tags origin "$current_sha"
  if ! git diff --quiet "$BASE_SHA" "$current_sha" -- \
    packages/ui/public/locales/ ':!packages/ui/public/locales/en.json' \
    packages/ui/translations/last-translated.en.json; then
    echo "Translations on ${TARGET_BRANCH} changed during generation. Run this workflow again against the updated branch." >&2
    exit 1
  fi
fi

translation_sha=$(git ls-remote origin "refs/heads/${TRANSLATION_BRANCH}" | cut -f1)
if [[ "$translation_sha" != "$TRANSLATION_SHA" ]]; then
  echo 'The translation branch changed during generation. Run again to include the latest corrections.' >&2
  exit 1
fi

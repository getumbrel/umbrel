# Updating translations

Edit English strings in `public/locales/en.json`. The generator maintains `last-translated.en.json` as a record of the last complete batch—**never edit this snapshot manually**.

## Run a batch

1. Open **Actions → Update translations → Run workflow**. The target branch defaults to `staging`; select **plan_only** to preview pending work without API calls.
2. Run generation, then review and merge its translation PR before merging staging into master.
3. Rerun if English changes. The workflow reuses the open PR and preserves unchanged translations, including reviewer corrections. Resolve any merge conflicts before retrying.

# Photos library read model

Photos stores its derived library in the disposable file index (`index.db`):
authorized file locations, selected Live Photo pairs, active pairs per Home/Trash,
and visible logical items. `library-sql.ts` remains the authoritative definition
of authorization, canonical locations, pairing and presentation fields.
`read-model.ts` evaluates those stages when their inputs change and replaces the
affected rows in the same transaction. Reads use the stored rows and their
indexes. Item details join the original metadata for EXIF and read the source name
from `photos_sources`. Renaming a source does not rebuild the library.

The timeline indexes cover account, Home/Trash, date and stable item ID; separate
indexes support kind, subtype and Favorites. The summary index contains all count
and date-grouping inputs. Summary and album queries use the stored table directly,
so SQLite can keep their joins indexed. Filtered pages count before hydrating a
bounded page. Search keeps the existing full-text indexes and account-scoped
location checks.

## Maintaining consistency

Existing file-index hooks refresh eagerly. Persistent change journals in **each**
database also record relevant entry/metadata/root changes and durable Photos state,
source and resource changes. This covers metadata tint updates and mutations made
while Photos is unavailable. Every stored-library read calls `syncPendingChanges`
before looking up data. When the journals are empty and generation markers match,
this performs only small state checks; it does not rescan the library.

Incremental refresh walks both the current exact-ID/fallback dependency graph and
previously stored pair edges. Old edges preserve dependencies after a motion is
deleted or its metadata changes. Expand dependencies before replacing pair rows,
then process bounded batches. Replacing only the directly changed hash can leave
another photo's companion or visibility stale. Album membership stays in its
durable table; Favorites update both durable state and stored rows directly.

Scope changes and large recovery operations rebuild an account's projection.
Rebuilds preserve the durable favorites, albums and backup identities in
`umbrel.db`. File-index schema v18 has an initialization marker for first-time
backfill, including when the disposable index is recreated. Photos schema v8
adds the durable change journals. Startup checks the existing generation markers
in both databases and rebuilds all accounts when they differ, repairing the
split-commit outcome possible for attached WAL databases. Journal changes,
projection updates, timeline dates and generation changes participate in the same
transaction and roll back together.

Startup uses the same 32,768-hash threshold as ordinary incremental maintenance;
128 is the processing batch size, not a reason to rebuild an entire account.
Explicit scope changes, uninitialized projections and mismatched generation
markers still require a full rebuild regardless of the pending-hash count.

Photos file moves resolve the destination's content identity and metadata before
acknowledging completion. A watcher may remove the source entry before the move
hint arrives, and orphan cleanup may reclaim its derived metadata. The destination
reuses existing content/metadata where available and otherwise prepares it again.
This keeps delete/restore results immediately addressable without relying on a
later background enrichment pass.

## Upgrade and rollback (2.0 rollout)

The final file-index schema is **20** and the durable Photos schema is **9**.
Schema 19 adds stored indexing counters. Schema 20 removes the duplicated source
name; durable schema 9 replaces the v8 source-update trigger so name-only changes
do not invalidate the account. Existing v18/v19 indexes upgrade in place, and the
source-name migration preserves their stored library rows.

On the first upgrade from a build without stored library tables, startup builds
the projection and indexing counters from the existing index. This is synchronous
work in the shared file-index worker and delays Photos readiness. Expect a longer
first Photos startup on large libraries; do not describe it as a repeated cost on
every boot. Index recreation, recovery and scope changes can also require a rebuild.
See the [review follow-up measurements](../../../scripts/benchmarks/photos-read-model/review-followup.md)
for the measured cost and its limits.

**OS rollback does not roll back persistent application data.** Existing Photos
migration policy rejects a durable schema newer than the running code understands,
preserving `umbrel.db` rather than deleting it or guessing how to downgrade it.
After this update, a fallback build supporting only Photos schema 7 or 8 therefore
cannot serve Photos. The disposable file index can be recreated by older code;
ordinary Files indexing remains available when Photos is unavailable.

For a 2.0 rollout, retain a supported pre-upgrade data backup if a data rollback is
required. To recover Photos after an OS fallback, return to a build supporting the
upgraded schema, or restore a matching pre-upgrade backup through the supported
restore procedure. Restoring older data loses changes made since that backup.
Never lower schema-version records or delete `umbrel.db` to force a downgrade:
it contains shared durable data, including Photos favorites, albums and backup
identities. Automatic Photos schema downgrades remain unsupported.

When adding a new input to the library projection, update its journal trigger and
eager maintenance path. Keep non-library activity out of the journals. Add a new
migration when changing the stored schema or projection semantics so existing
installations rebuild the affected data.

[Benchmark results and reproduction](../../../scripts/benchmarks/photos-read-model/README.md)
include every read case and the additional write/storage costs.

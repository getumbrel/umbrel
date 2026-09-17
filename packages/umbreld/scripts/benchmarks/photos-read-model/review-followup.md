# Review follow-up: Photos performance and consistency

Code compared: `a201e4f17` before review fixes and `053742f45` after them.
[Feedback tracking comment](https://github.com/getumbrel/private-umbrel/pull/1529#issuecomment-5700949223).

## Findings and resolutions

1. **Missed UI refresh:** consume the scheduled event before awaiting older reads,
   so events received during that wait still queue one follow-up. A React test
   using a real QueryClient/QueryObserver reproduces A waiting, a new filter B,
   another change, B returning stale data, and the final fresh response. It fails
   before the fix and passes afterward.
2. **Intermittent Trash lookup failure:** a watcher can remove the old index entry
   before the explicit move hint reuses its content identity. Cleanup can also
   reclaim orphaned metadata in that gap. Photos moves now resolve the destination
   hash and metadata before completing, reusing existing work where possible.
   The deterministic regression pauses hashing after removing the source entry,
   verifies the move remains pending, and verifies immediate Trash lookup with
   favorites/album membership preserved afterward. The original CI failure passed
   on rerun; the regression establishes this race independently rather than
   claiming the original log proves its exact ordering. The existing VM assertions
   remain immediate; no retry or weakened assertion was added.
3. **Source rename rebuild:** item details now read the authoritative source name
   using its indexed ID and account. Durable migration 9 removes name-only updates
   from the account invalidation trigger; index migration 20 drops the duplicated
   name. Tests forbid library-row replacement during rename and verify details,
   source lists, account isolation, persistence and migration from v8/v19.
4. **Startup cutoff:** use the existing 32,768-hash account-wide cutoff at startup.
   The 128-hash batch size no longer triggers a full account rebuild. A regression
   with 129 dirty hashes and 131 unaffected photos aborts if any unaffected row is
   replaced, and checks results against the authoritative projection.
5. **Upgrade/rollback expectations:** document the one-time synchronous backfill,
   measured rebuild cost and the existing no-downgrade policy. Older Photos code
   refuses newer durable schemas and preserves user data. An isolated probe using
   staging's actual v7 migration rejects a v9 database without changing sources,
   favorites, albums, resource identities or migration records; current code then
   reopens it successfully. Existing engine tests also cover Files remaining
   available and Photos recovering when a supported database is restored.

See the [upgrade and rollback notes](../../../source/modules/photos/README.md#upgrade-and-rollback-20-rollout).
Automatic durable-schema downgrades remain unsupported; this is documented policy,
not a new compatibility guarantee.

## Device costs

Same device and 34,935-visible-item library, using online SQLite snapshots and
isolated database copies. The live library and installed OS were not modified.
Each variant starts from the same normalized snapshot. Timings include mutation
and synchronization commits; they exclude copying, schema migration, initial
stabilization and other boot work. These are database timings, not live RPC or
worker-queue latency measurements.

| Operation                           | Before review fixes | After review fixes |
| ----------------------------------- | ------------------: | -----------------: |
| Rename source + list sources        |            18.322 s |            0.179 s |
| Startup with 129 pending changes    |            16.991 s |            0.379 s |
| Rebuild all accounts                |            16.773 s |           16.393 s |
| Change library scope + read summary |            16.655 s |           17.066 s |
| First projection/counter backfill   |            16.509 s |           16.535 s |

Rename is the median of three observations (before: 16.60–19.59 s; after:
0.162–0.202 s). Every other cell is one observation on the busy device; small
before/after differences are not evidence of a regression or speedup. All resulting
summaries and indexing states match, including the pre-existing single media
preparation failure. [Raw device measurements](review-device.json).

The first backfill costs about **16.5 seconds** on this library, in addition to
other startup work. Required scope changes and full rebuilds remain expensive.
The fixes avoid unnecessarily paying that cost for a rename or 129 pending changes.
They do not establish responsiveness during sustained ingestion.

## Read compatibility and validation

The same two existing synthetic 35k-media fixtures were copied from the previous
stored-counter benchmark, then migrated only for the fixed variant. The baseline
uses the exact `a201e4f17` repository implementation. Both variants run against their
own equivalent database copy, including the appropriate stored schema.

- 82 cases × two fixtures × two variants × six calls = **1,968 calls**.
- Every complete result hash matches, including ordering, cursors and missing values.
- Median SQL timing excludes the first call; variants alternate order each repeat.
- No read regressed by both more than 5% and more than 0.15 ms.
- [All 164 read comparisons](review-reads.csv).
- **380 backend tests** in 15 files passed, plus the two new upgrade tests
  (the complete migration file passed all 12 tests separately).
- All **11 refresh-hook tests**, UI/backend TypeScript and changed-file formatting passed.
- Final VM/CI results are recorded on the PR; these local tests do not replace them.

The synthetic fixture generator still resides on the pinned, unmerged benchmark
branch documented in the historical README. These measurements use those existing
fixtures; a fresh checkout alone does not contain their generator. No cache flush,
concurrent-ingestion benchmark or percentile estimate was performed.

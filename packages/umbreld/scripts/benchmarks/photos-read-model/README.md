# Photos stored read model benchmark

These are historical measurements of `dc503950c`, before the later small-source
lookup, stored-status-counter and review fixes. The fixture harness is pinned to
the separate, unmerged `photos-schema-benchmark` commit linked below; it is not
included in a checkout of this branch. See the [review follow-up](review-followup.md)
for the latest comparison, migration costs and validation.

The production read model reduces the library summary from **884 ms to 30 ms**
locally, compared with the preceding query-only PR. The original deployed query
was **2.09 seconds on this machine** and **13 seconds on the affected Umbrel**.
At the time of these measurements, the stored schema had not yet been benchmarked
on that device. The follow-up records subsequent device measurements.

The complete read matrix covers **89 cases on each of two fixtures**, with one
first call and three repeated calls per case: **712 calls**, all matching the
previous implementation's complete results. No read regressed by both more than
25% and more than 1 ms. [reads.csv](reads.csv) includes every median, first call,
range and result hash. [writes.csv](writes.csv) includes all 25 write scenarios.

## Reads

Milliseconds, median of three repeated calls. These include SQL preparation and
execution/row materialization, and exclude worker waiting, HTTP and image generation.

| Query                           | Fixture     | Previous PR | Stored model |
| ------------------------------- | ----------- | ----------: | -----------: |
| Summary                         | Device-like |      884.32 |        30.50 |
| Sources                         | Device-like |      832.43 |        24.33 |
| First 200 items                 | Device-like |       10.12 |         0.75 |
| Photos filter                   | Device-like |       31.93 |         0.81 |
| Live Photo filter               | Device-like |      797.00 |         0.18 |
| Ordinary item details           | Device-like |        4.76 |         0.51 |
| Previous/next                   | Device-like |        1.03 |         1.14 |
| Favorites                       | Mixed       |      791.77 |         0.21 |
| List 20 populated albums        | Mixed       |     1005.85 |        17.93 |
| Page of a 10k-membership album  | Mixed       |      853.40 |        14.62 |
| Positive search                 | Mixed       |      881.99 |        30.12 |
| Existing 192px thumbnail lookup | Mixed       |        0.09 |         0.05 |

The final filtered page query counts using the covering index, then loads only
one page of item rows. This avoids fetching all matching rows for a window count.
Album lists also read the stored table directly. Only item details join EXIF.

## Write and storage costs

Each write sequence ran four times on a fresh local copy/connection. The first
sequence validated all stored item fields, authorized locations, derived/active
Live Photo pairs, and durable timeline dates against a fresh authoritative query
after **every mutation**, for both accounts. The other three supply the medians.
No correctness check failed.

| Database operation   | Previous PR | Stored model |
| -------------------- | ----------: | -----------: |
| Add ordinary item    |     9.94 ms |     12.17 ms |
| Add Live Photo pair  |     8.37 ms |      7.33 ms |
| Delete final copy    |     0.38 ms |      0.67 ms |
| Favorite on          |     4.59 ms |      0.38 ms |
| Metadata date change |     4.52 ms |      5.08 ms |
| Add 1,000 items      |   456.45 ms |    446.78 ms |
| Delete 1,000 items   |    80.60 ms |    170.55 ms |
| Change source scope  |      1.32 s |       4.72 s |
| Rebuild all accounts |      1.24 s |       4.88 s |

These are low-level database mutations plus production journal maintenance and
an actual commit. Favorites use `setFavorite`; other cases deliberately omit the
indexer's eager callbacks and drain `syncPendingChanges`, exercising the recovery
path. They exclude hashing, metadata extraction, filesystem operations and API
work. Existing eager path hooks additionally capture dependencies before detaching
files; this benchmark does not measure their complete event processing time.
The ordinary addition is the first operation on a new connection and includes
first-use statement preparation and TEMP staging setup; it is not a sustained
ingest throughput measurement. Validation and explicit WAL checkpoints are outside
the timing. Automatic checkpoints during commits remain included.

The read model and journals add **54.47 MiB** to the device-like fixture and
**54.84 MiB** to the mixed fixture after checkpointing. Initial backfills took
**3.59 s** and **3.61 s**, respectively (one observation each). Bulk updates write
more WAL: adding 1,000 items grew from 17.22 MiB to 33.66 MiB; deleting 1,000 grew
from 12.15 MiB to 26.07 MiB. WAL volume is not a physical SSD-endurance measurement.

## Reproduce

Use Node 22 with the umbrella package's installed `tsx` and native `better-sqlite3`
dependencies. The recorded host was an M4 Max, Node 22.14.0, SQLite 3.53.2. Both
attached databases used WAL, with the normal application's default SQLite settings.
No `ANALYZE`, extra base-table indexes, or larger memory budgets were applied.

First run the synthetic experiment documented on branch
[`photos-schema-benchmark` at `78429407b`](https://github.com/getumbrel/private-umbrel/tree/78429407b/packages/umbreld/scripts/benchmarks/photos-schema).
It creates two deterministic fixtures and the previous PR's reference results:
35,000 media files / 277,076 total entries in the device-like fixture, and a mixed
fixture with overlapping sources, populated albums/Favorites/Trash and another
account. These are synthetic files and metadata, with placeholder ready-thumbnail
artifacts.

From `packages/umbreld` in this branch:

```sh
export PHOTOS_SCHEMA_HARNESS=/absolute/path/to/photos-schema-benchmark/packages/umbreld/scripts/benchmarks/photos-schema
export PHOTOS_BENCH_DIR=/absolute/path/to/completed-synthetic-experiment
export PRODUCTION_PHOTOS_BENCH_DIR="$(mktemp -d -t photos-read-model)"
node --import tsx scripts/benchmarks/photos-read-model/verify.mjs build
node --import tsx scripts/benchmarks/photos-read-model/verify.mjs reads
node --import tsx scripts/benchmarks/photos-read-model/verify.mjs writes
```

The verifier migrates local copies of the fixtures. Each read case runs in a
separate process and connection, with a 75-second process limit. Result hashes
include field values, ordering, cursors, Buffers and missing values. Plans and
individual measurements are saved with the results. Run benchmarks sequentially,
without other tests or benchmarks competing for the machine. No OS cache flush is
performed; these are warm repeated measurements, not cold-disk or p95 estimates.
The read harness skips the existing source-initialization no-op insert, and
rejects every other attempted write on its read-only connection.

Recorded measurements use implementation `dc503950c`. Unit coverage also checks
rollback during first-time staging setup, orphaned-account generation advancement,
root ownership changes, unchanged root/source registrations, and avoiding repeated
projection of large Live Photo components across batches.

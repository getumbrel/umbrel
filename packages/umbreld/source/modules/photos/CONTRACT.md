# Photos v2 — backend contract

What umbreld provides for the Photos UI. A logical photo is identified by its
32-byte BLAKE3 content hash. Durable account/hash state lives in namespaced
`photos_*` tables in the shared `<dataDirectory>/umbrel.db`; filesystem
locations, content hashes, media metadata, search terms, and thumbnail work live
in the disposable `<dataDirectory>/file-index/index.db` or artifact directories.
The shared database is backed up and is never quarantined with the rebuildable
index.

iPhone backups are ordinary files in the account's Home Photos directory, under
a stable, client-supplied friendly device folder such as
`/Home/Photos/Luke's iPhone` (or `/Users/Luke/Photos/Luke's iPhone` for a
member). Resource files are sharded below that folder by the first byte of their
64-character resource key, for example `ab/abcdef….heic`, so a large library
does not create one oversized directory. The folder layout is presentation and
upload-routing state, not identity.
`umbrel.db` relates each PhotoKit resource to its content as
`(account_id, source_id, resource_key, content_hash)`, plus the asset's iCloud
identity when the client sends it (see iPhone backup below); the disposable
file index resolves that hash to whichever accessible path currently contains
the bytes.
The client must assign a distinct resource key to every resource within a
source, including separate keys for a Live Photo's still and motion resources.
New uploads also carry the original filename because the resource-key storage
path cannot preserve it. They carry PhotoKit's creation date only as a fallback
for resources whose bytes contain no capture date; it then takes precedence
over the stored file's own dates. Media type, other capture
metadata, and Live Photo relationships are derived from the uploaded files by
the indexer rather than duplicated in the client contract. Mutable library state
such as favorites and album membership is deliberately not part of the
byte-upload receipt.
Moving or renaming an uploaded media file therefore does not lose its iPhone
source attribution or backup receipt. Before returning a receipt, the server
reopens the indexed path and verifies that it is still the exact indexed file
revision; an index row alone is never treated as proof that the bytes remain on
disk. Exact upload retries reuse matching bytes, and an upload whose bytes its
backup already has is answered from that copy (see iPhone backup below). If
the same resource key later contains different bytes, or the user edited its
ordinary Home file, publication uses Files' keep-both naming instead of
overwriting either version.

Client receipts contain only the stable resource key and byte count. Filesystem
paths remain an internal implementation detail because users can move or rename
the corresponding Home file without changing its backup identity.

The backup transport accepts PhotoKit resources with any protocol-valid file
extension, including formats the Photos library cannot yet enrich (for example,
AAE sidecars). Those bytes and their durable receipt are preserved, but they do
not appear as Photos items until the format is supported. Existing private-layout
backups are moved into the account Home and their relations rebuilt the first
time that source is registered after upgrade. Source registration, grants,
uploads, and removal are serialized per account/source; removal is recorded as a
durable intent and replayed after a restart before the source can be used again.

Account and path authorization is applied before locations are grouped by hash.
Consequently, duplicate bytes are returned once per Home/Trash view without
revealing copies that belong to another account. For path-based operations, the
backend chooses the first currently accessible location ordered by root virtual
path and relative path, and falls back to the next location if it disappears.
Filename search considers every accessible duplicate in the selected view, not
just that canonical location. Home source filters never hide Trash media. Items
are omitted until their hash and media metadata are ready; the separate
indexing-state procedure tells the client when the Home result set is still
warming.

Files Trash is the only deletion source of truth. The normal library projects
media from the account's Home root; the Deleted view projects every indexed
photo/video from that account's Trash root. There is no Photos deletion marker,
retention period, or automatic cleanup. Trash therefore needs the same hashes,
media metadata, live-pair data, and Photos thumbnail variants as Home.
Trash bytes deliberately do not satisfy a phone's backup receipt: once the last
Home copy is deleted, a resource that still exists on the phone may be backed up
again. This is backup behavior, not bidirectional deletion sync, and prevents a
phone from freeing its original based only on a copy the user can permanently
empty from Trash.

Not in v1 (no routers or fields exist for them): people, place names, semantic
search, Android motion photos (the MP4-embedded-in-a-JPEG kind — needs byte
slicing at import; Apple live pairs are in, see SubKinds). Search suggestions are
built client-side from `library.summary` + `sources.list` + `albums.list` — no
suggest endpoint. The importer should still extract and index everything it
reads in its one pass over the file — GPS coordinates included — so Locations
and friends can ship later without re-scanning the library. Coordinates reach
the UI through `ItemDetail.location`, the map's packed points and the
`bounds` filter (see Map below); nothing names places on the server yet.

## Vocabulary

```ts
type Kind = 'photo' | 'video'
// Presentation tier over Kind, derived once at import — see SubKinds below.
// Absent = plain photo/video.
type SubKind = 'live' | 'panorama' | 'screenshot' | 'spherical'
// A phone is 'iphone' or 'android' by the platform its app reported. Drives and
// network shares land after v1
type SourceType = 'umbrel' | 'iphone' | 'android'
type ScopeMode = 'everything' | 'everything-except' | 'only'
```

## Shapes

```ts
// Grid item — deliberately lean, the grid holds tens of thousands
type Item = {
	id: string // lowercase 64-character BLAKE3 hex digest
	kind: Kind
	subKind?: SubKind
	// Epoch ms; the embedded capture time. Media without one uses the backup
	// source's date, else the earlier of the file's modification and birth
	// times: birth time is when the file landed on this disk, while copies,
	// network shares and browser imports keep the original modification time.
	takenAt: number
	// The offset matching the selected EXIF date as minutes east of UTC, when present.
	takenAtOffsetMinutes?: number
	width: number // display pixels, after EXIF orientation or video crop, pixel aspect and rotation
	height: number
	durationMs?: number // videos only
	isFavorite: boolean
	tint?: number // average colour packed 0xRRGGBB, computed once at import
}

// The viewer's info panel
type ItemDetail = Item & {
	fileName: string
	sizeBytes: number
	source: {id: string; name: string; type: SourceType}
	path: string // virtual path in the selected Home or Trash projection ("Show in Files")
	createdAt: number // embedded creation/capture time, else the same fallback as takenAt
	importedAt: number // epoch ms the import wrote the row
	// Partial camera metadata plus EXIF UserComment. Camera values are
	// display-ready strings, except iso.
	exif?: {
		make?: string
		model?: string
		lens?: string
		focalLength?: string
		aperture?: string
		exposure?: string
		iso?: number
		userComment?: string
	}
	// Raw EXIF coordinates, straight off the index — the info panel's location
	// row (formatted coords + an "Open in Maps" link out).
	location?: {lat: number; lng: number; altitude?: number}
	albums: {id: string; name: string}[]
}

// All clauses AND together; within one array, any match counts.
// Each field is one predicate — the UI's sidebar sections are just presets
// (Favorites = {favorite: true}, Deleted = {deleted: true}, …).
type Filter = {
	query?: string // every term must appear in the file name, camera make/model, or UserComment
	kind?: Kind
	subKind?: SubKind // the Panoramas / Screenshots / Live Photos / 360° sections
	favorite?: boolean // absent = don't care
	deleted?: boolean // absent or false = live items only; true = deleted items only
	sourceIds?: string[]
	albumIds?: string[]
	dates?: {from: number; to: number}[] // half-open [from, to) over takenAt
	// Taken inside this stretch of the map, in degrees, edges included. West
	// greater than east crosses the antimeridian. Items without coordinates
	// never match. Longitudes outside -180..180 or latitudes outside -90..90
	// are rejected: BAD_REQUEST over tRPC, 400 from the map points endpoint.
	bounds?: {west: number; south: number; east: number; north: number}
}

type Album = {
	id: string
	name: string
	count: number
	coverId?: string // user-chosen (setCover), else the newest member — the fallback also covers a chosen item that was deleted or removed
	takenFrom?: number // oldest member's takenAt; absent when empty
	takenTo?: number // newest member's takenAt
	createdAt: number // epoch ms the album was created
}

// States, progress, paths and auto-import settings return with the post-v1
// source types (drives, shares)
type Source = {
	id: string
	type: SourceType
	name: string // account name / device name
	lastImportAt?: number // epoch ms; a phone's last backup
	createdAt: number // epoch ms the source was added
	stats: {photos: number; videos: number; sizeBytes: number}
	scope?: {mode: ScopeMode; paths: string[]} // the umbrel source: which folders count
}
```

## Media metadata readers

ExifTool is the single semantic metadata reader for photos and videos. One
targeted, numeric JSON pass supplies orientation-aware still dimensions,
capture dates and offsets, camera and lens fields, exposure, GPS, projection,
EXIF `UserComment`, and Apple Live Photo content identifiers. Group-qualified
tags are retained so camera identity can be accepted from camera metadata and
known QuickTime key locations without mistaking an ICC profile's manufacturer
for the camera make. ExifTool also decodes EXIF strings and normalizes GPS signs,
so the indexer does not maintain its own TIFF `UserComment`, rational GPS, or
LibRaw-specific metadata parsers.

Capture-date precedence is `DateTimeOriginal` with `OffsetTimeOriginal`, then
timezone-bearing `CreationDate`, `CreateDate` with `OffsetTimeDigitized`,
`MediaCreateDate`, and finally `ModifyDate` with `OffsetTime`. A date and its
separate offset always travel as a pair; an invalid higher-priority date falls
through without donating its offset to a lower-priority value. Inline `Z` and
numeric offsets are preserved as `takenAtOffsetMinutes`. With ExifTool's numeric
output, raw EXIF coordinates remain unsigned, so the allowlist also requests
their latitude, longitude, and altitude reference tags and prefers ExifTool's
signed `Composite` values. QuickTime `GPSCoordinates` remains authoritative for
its altitude because the corresponding composite is absolute. Invalid ranges
and the `(0, 0)` missing-location sentinel are discarded.

Normal videos and camera RAW photos must not use ExifTool's `IgnoreTags=all`
optimization. For videos it prevents the Apple `VideoKeys` table from being
decoded even when individual leaf tags are requested. For RAW containers it
prevents vendor dimensions from satisfying the dependencies of ExifTool's
`Composite:ImageSize`, which can otherwise select a small IFD0 preview. The
video allowlist explicitly includes QuickTime
`GPSCoordinates`, `FocalLengthIn35mmFormat`, `CameraLensIrisfnumber`, and
`LensModel`; these are normalized into the same location, focal-length,
aperture, and lens fields as still-image EXIF. Ordinary photos and INSV retain
`IgnoreTags=all`; their required tags remain directly readable, and INSV needs
the restriction while its embedded-document scan walks the Insta360 trailer.

Photo metadata is accepted only when ExifTool supplies valid positive image
dimensions. Missing dimensions are an extraction failure rather than a
synthetic 1×1 ready item. Camera RAW dimensions prefer
`Composite:ImageSize`, which resolves the primary image across TIFF-based and
vendor RAW containers; regular stills use the same value when available and
fall back to the selected width/height tags.

FFprobe remains required for videos, but only for facts for which the decoded
stream is authoritative: whether a video stream is playable, its playable
duration, and its display dimensions after crop, sample aspect ratio and
rotation. Codecs, pixel and colour formats, audio stream details, and Dolby
Vision descriptors are not requested because the current Photos index does not
store or consume them.
Creation time, projection, Live Photo identifiers, and camera fields come only
from ExifTool rather than being merged from competing readers. The two video
passes run concurrently, and ExifTool remains best-effort for videos so an
unusual metadata trailer cannot reject an otherwise playable clip.

ExifTool's embedded-document scan (`-ee`) is limited to INSV files. It is
required to reach Insta360's trailer, but applying it to every video also walks
timed telemetry such as accelerometer and GPS samples. Only explicitly requested
tags are emitted. ImageMagick remains the bounded media decoder for thumbnails
and tint generation; it is not a metadata authority. The reader change requeues
all existing media metadata once on upgrade so stored values and Live Photo
relationships converge on the same precedence as newly indexed files.

## SubKinds & live pairs

Spherical, screenshot and panorama tags are derived once at import, from the
same metadata pass that reads dates and dimensions; Live Photos are derived
from the indexed still and motion metadata when the library is queried. When
heuristics overlap the first match wins, in this order — a photo sphere is ~2:1
equirectangular, so the panorama heuristic would also match it, and the tag must
win:

1. `spherical` — the spherical video box (v1 `Spherical`/`ProjectionType` XML
   or v2 `sv3d`/`proj`) on videos, including Matroska's numeric equirectangular
   projection type; XMP `GPano:ProjectionType` on photos.
2. `live` — the still of an Apple live pair (below).
3. `screenshot` — `Screenshot*`/`Screen Shot*` file names, a `UserComment`
   containing `screenshot`/`screen shot` (case-insensitive), or a PNG with no
   camera `Make`/`Model` EXIF.
4. `panorama` — aspect ratio ≥ 2:1.

**Live pairs.** An Apple live photo lands as two files sharing one identifier:
`MakerNotes:ContentIdentifier` on the HEIC/JPEG, and
`com.apple.quicktime.content.identifier` on the MOV (fallback pairing: same
basename + folder + a short MOV). Enrichment stores only those file-level facts
in the disposable index. Queries derive the pair on demand within the account
and Home/Trash projection, prefer an exact identifier match, expose the still as
`subKind: 'live'`, and exclude the companion MOV from every listing, count and
search — no separate pair state is persisted or refreshed. `delete`/`restore`/
`deletePermanently` derive the same pair and cascade to the companion; favorites
and album membership are still-only. Thumbnails and tint come from the still
like any photo; the motion clip is looked up from the same indexed metadata and
served at `GET /api/photos/live/:id`. All playback UX is the frontend's.

## tRPC procedures — `photos.*`

### library

- `summary()` → `{counts: {items, favorites, photos, videos, deleted}, sizeBytes: number, bySubKind: Record<SubKind, number>, bySource: Record<string, number>, months: {year: number, month: number, count: number}[]}`
  — the one call the sidebar, header and search share. All counts except
  `deleted` are over live (non-deleted) items; `items` is the whole library.
  `sizeBytes` = the live originals' total bytes ("48,210 items · 312 GB").
  `bySubKind` carries all four keys, 0 when the library has none.
  `months` is the library calendar: only months that hold items, newest first,
  `month` 1–12 — (year, month) rather than epochs so a server/browser timezone
  difference can't shift a label.

### items

- `list({filter: Filter, cursor?: string, limit: number})` → `{items: Item[], total?: number, nextCursor?: string}`
  — newest first (`takenAt DESC, id ASC`), keyset pagination; the cursor is opaque
  to the client. `limit` up to 1000 (the grid asks for what it is about to draw).
  `total` = the filter's full match count — only needed when `cursor` is absent.
- `get({id, deleted?: boolean})` → `ItemDetail` — NOT_FOUND if missing from the
  selected Home (`false`, default) or Trash (`true`) projection.
- `neighbors({id, filter})` → `{prevId?: string, nextId?: string}` — the item's
  neighbours under the same order and filter as `list`; the lightbox's deep-link case.
- `setFavorite({ids, favorite})` — bulk.
- `delete({ids})` — moves every selected, account-owned Home media copy into the
  account's Files Trash. A live companion moves only when every still in that
  Home projection that references it is selected.
- `restore({ids})` — restores every selected, account-owned Trash media copy
  through Files, using Files' original-path metadata and collision rules.
- `deletePermanently({ids?})` — hard-deletes selected Trash media through Files;
  omitted `ids` resolves and deletes all photos/videos in the account's Trash,
  but never directories or non-media files. Every path is re-authorized at the
  Files boundary and atomically checked against its indexed revision, and
  inaccessible or other-account copies are never touched. Interrupted revision
  claims are recovered from account Home and Trash roots during Files startup.

### map

- `basemap()` → `{available: boolean, maxZoom: number, build?: string}` —
  whether there is a basemap to draw (see the map tile endpoints below), which
  build of the planet, and the deepest zoom the map can ask for tiles at; it
  magnifies past that. Available when the zoom-0 tile can be fetched within
  five seconds; the answer is kept for a minute. Unavailable, the UI draws the
  atlas it bundles.

### albums

- `list()` → `Album[]`
- `create({name, ids?})` → `Album`
- `rename({id, name})`
- `setCover({id, itemId?})` — `itemId` must be a member; omitted = back to the
  derived newest-member cover.
- `delete({id})` — items stay in the library.
- `addItems({id, ids})` / `removeItems({id, ids})` — bulk membership.

Favorites, album membership and covers are keyed by account plus content hash.
They therefore survive Home/Trash moves and a disposable file-index rebuild,
and reconnect when the same bytes are indexed again. An in-place byte edit is a
new hash and deliberately does not inherit old state.

### sources

- `list()` → `Source[]` — always includes the permanent `umbrel` source (identified
  by `type === 'umbrel'`; the UI renames it after the account). Phones appear here
  when they pair through the mobile app — there is no `add` procedure in v1.
- `update({id, scope?})` → `Source` — partial patch. Folder scope is supported
  only by the built-in `umbrel` source; phone source scope updates are rejected.
- `remove({id, keepItems: boolean})` — unpair a phone; `keepItems: false` also
  moves its items to Recently Deleted so the ordinary Home index cannot
  immediately re-import them as Umbrel items. If the same bytes exist at more
  than one visible Home path, removal preserves the logical item as an Umbrel
  item rather than risking deletion of an independently kept duplicate. It
  also keeps bytes another iPhone's receipt names. The `umbrel` source refuses
  removal.
- `removalItemCount({id})` → `number` — for the remove dialog, how many of a
  phone's items `keepItems: false` would move to Recently Deleted, counted as
  `list` counts them: the ones nowhere else in Home and named by no other
  phone's receipt. It reads the index as it stands, while removal rescans Home
  first. NOT_FOUND for anything but one of the account's phones.

Errors: plain tRPC errors (NOT_FOUND etc.) — the UI shows generic toasts, no
special error-code vocabulary.

## HTTP endpoints

Authorized like Files' HTTP endpoints (dashboard token). The client derives all
of these URLs from item ids — API responses carry no URL fields.

- `GET /api/photos/thumb/:id?s=<192|512|1280>` — generates a missing rendition
  on demand while the background enrichment queue prepares all three sizes
  (videos: from the poster frame). Every rendition preserves aspect ratio,
  scales until its short edge reaches the requested size, and is never cropped,
  padded, stretched or enlarged beyond the oriented source dimensions. EXIF
  auto-orientation runs before resizing. When several renditions are missing,
  ImageMagick writes them from one oriented decode/invocation.

  | `s`  | Scaling           | WebP quality | Serves                                                                                                                                  |
  | ---- | ----------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
  | 192  | 192px short edge  | 75           | WebGL mosaic (client crops the centre square itself), grid tiles up to 192 device px, filmstrip, ⌘K tiles, the lightbox's fallback seed |
  | 512  | 512px short edge  | 80           | grid tiles above 192 device px, album covers                                                                                            |
  | 1280 | 1280px short edge | 80           | lightbox resting image (original fetched only for download), video posters                                                              |

  The lightbox never requests a 192 or 512 of its own choosing: it flies in on
  whichever rendition the item's tile already has on screen (the 192 when there
  is no tile), and everything it fetches is the 1280.

- `GET /api/photos/original/:id` — the original bytes; range requests for video.
  `?download` switches to attachment disposition.
- `GET /api/photos/live/:id` — a live pair's motion clip; only for items with
  `subKind: 'live'`, NOT_FOUND otherwise. Range requests like the original.
- `photos.items.createDownload({ids})` returns a short-lived, account-bound,
  single-use download ticket.
- `GET /api/photos/download?ticket=…` — one selected item is returned as a
  file attachment; several are returned as a flat zip stream. Every item is
  re-authorized for the ticket's account when the HTTP request is handled.
- `POST /api/photos/upload?name=IMG_1234.jpg&album=<id>&lastModified=<ms>` — body
  = the bytes, one file per request; `album` optional, validated before the bytes
  stream, files the item on success. `lastModified` is optional (older clients
  omit it): the browser's `File.lastModified` in epoch ms, which becomes the
  stored file's modification time so media without an embedded capture date
  keeps its original date, now and after any rescan. A value that is not a
  positive integer up to year 9999 → 400 before the bytes stream. The complete
  hidden temporary file is BLAKE3-hashed and
  checked for an account-local duplicate before it is published into the
  library; duplicate bytes are discarded without creating a visible pathname,
  and the copy already in the library keeps its own dates.
  2xx answers `{status: 'imported' | 'duplicate'}`, and the upload island reports
  "N added · M already in your library".
  Unsupported file types → 415 (the UI filters its pickers too) so nothing is
  silently swallowed.

### Map data

The Map view clusters every located item itself, so the whole selection has to
fit on the wire, and it never asks a third party for anything: points come from
umbreld and so does the basemap. Its list beside the map is `items.list` with a
`bounds` filter, so the grid, the lightbox and selection work unchanged.

- `GET /api/photos/map/points?filter=<Filter as JSON>` — little-endian: how many
  of the items the filter selects have no coordinates (uint32), then every one
  that does, in the timeline's order (newest first), as packed 52-byte records:
  content hash (32 bytes, the item id as bytes), latitude and longitude
  (float32), takenAt (float64 ms), flags (uint8: favorite 1, video 2, live 4,
  panorama 8, screenshot 16, spherical 32, has tint 64) and tint (3 bytes RGB).
  Revalidated by ETag, which saves the transfer when nothing moved but not the
  read: it is the heaviest Photos read there is, so the UI asks again at most
  every ten seconds while the library is changing.
- `GET /api/photos/map/tiles/:z/:x/:y?build=<build>` — a Protomaps vector
  tile (MVT), gzipped, or 204 where the build has no tile. Asked for under the
  build it is of (`basemap().build`), either is the browser's to keep for good
  (`private, max-age=31536000, immutable`): a build never changes. Under any
  other build (a page drawn before a new one came) it is the current build's,
  `no-cache`. 404 where it can't be had (`no-store`), 400 for a tile that isn't
  on the map.

The map's labels are drawn by the browser, in the Inter the UI already loads
(scripts Inter lacks in the device's own fonts): no fonts are served, fetched,
kept or hosted.

Nothing of the basemap ships with the OS. umbreld fetches each tile as the map
asks for it from the one build of the planet Umbrel keeps on Cloudflare R2
(zooms 0–15; `umbrelPlanet` in `map-tiles.ts`). Where it is comes from
`GET https://api.umbrel.com/map-url`, `{url, expires}`, and `url` takes either
of two shapes, so the API alone can move devices between them:

- `…/<build>.pmtiles?<signature>`: the PMTiles archive itself, a URL signed for
  R2, read by byte range (a tile in a new area is two or three reads in a row).
  A 403 from R2 drops the URL and asks once more.
- `…/<build>/{z}/{x}/{y}.mvt`: a server of its tiles, such as Protomaps'
  Cloudflare Worker, one request per tile (204 = no tile). Its deepest zoom is
  read once per answer from the TileJSON beside it, `…/<build>.json` (with the
  same query), as `maxzoom`.

umbreld keeps the answer until shortly before `expires` (measured by the
response's own `Date`, so a device clock that is out doesn't matter) and asks
again an hour early, carrying on with the one it has if that fails; a failed
ask is retried a minute later at the soonest. The API's own cache (Vercel's
edge) must hold an answer for well under the signature's week, a day or so at
most: a device takes what lifetime is left, so an answer served in its last
hour has it asking every minute, and one served after it ran out has no map
until the cache turns over. The URL may be a credential: it
is never logged, and no error carries its query. Cloudflare sees the device's
address and which parts of the planet it reads; api.umbrel.com sees the device
about once a week.

umbreld keeps no tiles: the browser does, under the build. `<build>` is the
archive's file name or the tiles' directory (`planet-20261011` for
`…/v1/planet-20261011.pmtiles?X-Amz-…` and for `…/planet-20261011/{z}/{x}/{y}.mvt`
alike, so moving between the shapes keeps what browsers have kept); a new
planet comes under a new file name, so a new build. As browsers keep a build's
tiles for a year with no way for the device to take them back, a build's name
is never used again for anything else, at any path or host (a new schema of
the same day's planet included). In memory umbreld holds only the
answer from api.umbrel.com and, for an archive, up to 8 of its directories
(some 5 MB each). With no connection, or with api.umbrel.com or the planet
down, the UI draws the Natural Earth atlas it bundles.

## iPhone backup

The native apps back up PhotoKit resources with `POST /api/photos/upload` and
a source-bound grant from `photos.createBackupGrant`. Each request carries
`X-Umbrel-Photo-Backup-Key` (the resource key), `X-Umbrel-Photo-Backup-Extension`,
`X-Umbrel-Photo-Original-Filename-Base64` and optionally
`X-Umbrel-Photo-Creation-Date-Ms`. Newer apps also send
`X-Umbrel-Photo-Cloud-Identifier-Base64` (the UTF-8 of
`PHCloudIdentifier.stringValue`, at most 1024 bytes) and
`X-Umbrel-Photo-Resource-Role` (the resource's part of the asset, such as
`photo`, `live-photo-motion` or `video`; lowercase letters, digits and
`.`, `_`, `:`, `-`). Both or neither; anything else is a 400. The answer is
200 with `{resourceKey, bytes}` and the `X-Umbrel-Photo-Backup-Key` and
`X-Umbrel-Upload-Bytes` headers, whether or not the bytes were stored again.

**One copy per backup.** After the upload is staged and hashed, an exact
retry of the same resource key reuses its receipt. Otherwise, if another
receipt in this source already has the same BLAKE3 as a visible Home file,
the server records the new receipt against that file, discards the staged
bytes and answers normally. That covers a phone that took over this source
sending something the old phone already sent, and two phones on one source
sending the same photo. Only bytes this source has a receipt for are matched,
never bytes only another source received, though like any receipt (below)
the file recorded against can be any Home copy of them. Two uploads of the
same new bytes at the same moment can still store two copies.

**Receipts.** `photos.confirmedBackupResources({sourceId, resources:
[{resourceKey, fileExtension}]})` returns `{resourceKey, bytes}[]` for the
receipts that are still satisfied. A receipt is satisfied by any visible Home
file with its bytes: the copy this source uploaded, wherever the user moved
it, or another source's copy. Each indexed location counts once its revision
is found unchanged on disk; when none is, the server hashes the resource's own
upload path and each indexed location. Trash never satisfies a receipt.

**Restored or new phones.** A phone restored from an old one (or moved over
by Quick Start) continues the old phone's backup by using its source id (from
`photos.backupSources`) as its own, so its uploads go to the same folder. Its
first grant passes `continuing: true`, which renames the backup to its
`suggestedName`, so the backup isn't mistaken for the old phone's and removed.
Without it, a grant never renames an existing backup. The folder keeps its
name, as for any rename. Any other phone starts a backup of its own and uploads
everything. Before it uploads each batch, a phone claims what its own backup
already has. A cloud identifier names an asset across devices on one iCloud
Photos library, not a version of its bytes.
`POST /api/photos/claim` with the source's backup grant as the bearer and a
JSON body `{resources: [{resourceKey, fileExtension, cloudIdentifier?,
role?}]}` (at most 256; the cloud identity is both fields or neither) returns
the same shape as `confirmedBackupResources`, without any upload. The grant
names the source. A removed source answers 401, as an upload does, and a body
the server can't read answers 400 (413 when too large). umbrelOS without the
route answers 401, and the client then uploads as before:

- A resource that already has a satisfied receipt in this source returns it,
  and the receipt records the cloud identity. This is how a phone that backed
  up before identities existed becomes ready for a later restore.
- Otherwise, if this source's receipts recorded exactly one content hash for
  that cloud identifier and role, and those bytes are in Home, the server
  records a receipt for the new resource key and returns it. Another source's
  receipts are never matched.
- A resource without a cloud identity is only confirmed by its key, as when
  the app is installed again on the same phone and has lost its own record.
- Anything else is absent and must be uploaded. Content matching on upload
  then avoids a second copy when the bytes match.

Unedited originals are the reliable case: their bytes are the same on every
device. An asset edited after its first backup has receipts with two hashes
and is never claimed. An asset edited after its only backup still has one
hash, so the server cannot tell the new rendition from the old: clients should
claim only resources of assets without adjustments and upload the rest. A
Live Photo's still and motion are separate roles of one asset and are claimed
independently, each by its own role. Receipts from before cloud identities
can't be claimed until the phone that made them claims (and so names) them.

`photos.backupSources()` → `{capabilities: 'continue-source'[], sources: {id,
name, createdAt, lastImportAt?, lastSeenAt?, platform?, stats: {photos, videos,
sizeBytes}}[]}` lists the account's backup sources by the client's source id,
so a phone can continue one.
`lastSeenAt` is when the source last got an upload grant, and `platform` is what
its app reported then (`ios` or `android`), so a phone only continues its own
platform's backups. Clients detect support with it: 2.0.0 answers 404 and has
none of these capabilities.

## Events

- `photos:change` on the event bus — emitted after library mutations,
  filesystem discovery, and enrichment progress. No payload; the UI debounces
  one second and refetches what it is showing, so bursts are cheap.

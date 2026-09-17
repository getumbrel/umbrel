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
`umbrel.db` relates each PhotoKit resource to its content using exactly
`(account_id, source_id, resource_key, content_hash)`; the disposable file index
resolves that hash to whichever accessible path currently contains the bytes.
The client must assign a distinct resource key to every resource within a
source, including separate keys for a Live Photo's still and motion resources.
New uploads also carry the original filename because the resource-key storage
path cannot preserve it. They carry PhotoKit's creation date only as a fallback
for resources whose bytes contain no capture date. Media type, other capture
metadata, and Live Photo relationships are derived from the uploaded files by
the indexer rather than duplicated in the client contract. Mutable library state
such as favorites and album membership is deliberately not part of the
byte-upload receipt.
Moving or renaming an uploaded media file therefore does not lose its iPhone
source attribution or backup receipt. Before returning a receipt, the server
reopens the indexed path and verifies that it is still the exact indexed file
revision; an index row alone is never treated as proof that the bytes remain on
disk. Exact upload retries reuse matching bytes. If the same resource key later
contains different bytes, or the user edited its ordinary Home file, publication
uses Files' keep-both naming instead of overwriting either version.

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

Not in v1 (no routers or fields exist for them): people, locations, semantic
search, Android motion photos (the MP4-embedded-in-a-JPEG kind — needs byte
slicing at import; Apple live pairs are in, see SubKinds). Search suggestions are
built client-side from `library.summary` + `sources.list` + `albums.list` — no
suggest endpoint. The importer should still extract and index everything it
reads in its one pass over the file — GPS coordinates included — so Locations
and friends can ship later without re-scanning the library; v1 exposes only
the raw coordinates on `ItemDetail`, nothing else.

## Vocabulary

```ts
type Kind = 'photo' | 'video'
// Presentation tier over Kind, derived once at import — see SubKinds below.
// Absent = plain photo/video.
type SubKind = 'live' | 'panorama' | 'screenshot' | 'spherical'
// Android, drives and network shares land after v1
type SourceType = 'umbrel' | 'iphone'
type ScopeMode = 'everything' | 'everything-except' | 'only'
```

## Shapes

```ts
// Grid item — deliberately lean, the grid holds tens of thousands
type Item = {
	id: string // lowercase 64-character BLAKE3 hex digest
	kind: Kind
	subKind?: SubKind
	takenAt: number // epoch ms; embedded capture time, else source date, indexed birth time, or modification time
	// The offset matching the selected EXIF date as minutes east of UTC, when present.
	takenAtOffsetMinutes?: number
	width: number // pixels, after EXIF orientation
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
	createdAt: number // embedded creation/capture time, else source date, indexed birth time, or modification time
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
// source types (android, drives, shares)
type Source = {
	id: string
	type: SourceType
	name: string // account name / device name
	lastImportAt?: number // epoch ms; an iPhone's last backup
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
duration, and its crop- and rotation-adjusted display dimensions. Codecs, pixel
and colour formats, audio stream details, and Dolby Vision descriptors are not
requested because the current Photos index does not store or consume them.
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
  by `type === 'umbrel'`; the UI renames it after the account). iPhones appear here
  when they pair through the mobile app — there is no `add` procedure in v1.
- `update({id, scope?})` → `Source` — partial patch. Folder scope is supported
  only by the built-in `umbrel` source; iPhone source scope updates are rejected.
- `remove({id, keepItems: boolean})` — unpair an iPhone; `keepItems: false` also
  moves its items to Recently Deleted so the ordinary Home index cannot
  immediately re-import them as Umbrel items. If the same bytes exist at more
  than one visible Home path, removal preserves the logical item as an Umbrel
  item rather than risking deletion of an independently kept duplicate. The
  `umbrel` source refuses removal.

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
- `POST /api/photos/upload?name=IMG_1234.jpg&album=<id>` — body = the bytes, one
  file per request; `album` optional, validated before the bytes stream, files the
  item on success. The complete hidden temporary file is BLAKE3-hashed and
  checked for an account-local duplicate before it is published into the
  library; duplicate bytes are discarded without creating a visible pathname.
  2xx answers `{status: 'imported' | 'duplicate'}`, and the upload island reports
  "N added · M already in your library".
  Unsupported file types → 415 (the UI filters its pickers too) so nothing is
  silently swallowed.

## Events

- `photos:change` on the event bus — emitted after library mutations,
  filesystem discovery, and enrichment progress. No payload; the UI debounces
  one second and refetches what it is showing, so bursts are cheap.

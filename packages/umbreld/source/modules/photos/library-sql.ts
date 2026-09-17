import {filenameStemSql} from '../files/file-index/migrations.js'
import {PHOTO_EXTENSIONS, VIDEO_EXTENSIONS} from './types.js'

// Authoritative projection used only when indexed inputs change. Reads use the
// persisted tables maintained by PhotosReadModel.
const PHOTO_MEDIA_EXTENSIONS = [...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS]
const LIVE_FALLBACK_STEM_SQL = filenameStemSql('entries.name', PHOTO_MEDIA_EXTENSIONS)

function targetedPhotoContentCtes(hashCount: number) {
	const fallbackEntryStem = filenameStemSql('fallback_entry.name', PHOTO_MEDIA_EXTENSIONS)
	const fallbackEntryParent =
		'substr(fallback_entry.relative_path, 1, length(fallback_entry.relative_path) - length(fallback_entry.name))'
	const requestedValues = Array.from({length: hashCount}, () => '(?)').join(', ')
	return `WITH RECURSIVE requested_values(content_hash) AS (VALUES ${requestedValues}),
	requested_hashes(content_hash) AS MATERIALIZED (
		SELECT DISTINCT content_hash FROM requested_values WHERE content_hash IS NOT NULL
	),
	requested_account(account_id) AS (VALUES (?)),
	related_content_ids(content_id) AS (
		SELECT contents.id
		FROM requested_hashes
		CROSS JOIN contents INDEXED BY sqlite_autoindex_contents_1
			ON contents.blake3 = requested_hashes.content_hash

		-- Apple identifiers connect every still and competing motion that can
		-- change exact-pair selection or visibility for the current component.
		UNION
		SELECT peer_metadata.content_id
		FROM related_content_ids AS related
		CROSS JOIN media_metadata AS related_metadata ON related_metadata.content_id = related.content_id
		CROSS JOIN media_metadata AS peer_metadata INDEXED BY media_metadata_by_live_identifier
			ON peer_metadata.live_identifier = related_metadata.live_identifier
		WHERE related_metadata.state = 'ready' AND related_metadata.live_identifier IS NOT NULL
			AND peer_metadata.state = 'ready'
			AND EXISTS (
				SELECT 1 FROM entries AS account_entry
				JOIN index_roots AS account_root ON account_root.id = account_entry.root_id
				WHERE account_entry.content_id = peer_metadata.content_id
					AND account_root.owner_id = (SELECT account_id FROM requested_account)
					AND account_root.kind IN ('home', 'trash')
					AND account_entry.type = 'file' AND account_entry.hidden = 0
			)

		-- The same-folder/stem fallback can overlap exact-ID groups. Recursing
		-- until convergence is necessary: a newly selected exact pair can expose
		-- a fallback motion, which can in turn change another exact group.
		UNION
		SELECT fallback_entry.content_id
		FROM related_content_ids AS related
		CROSS JOIN entries AS related_entry INDEXED BY entries_by_content
			ON related_entry.content_id = related.content_id
		JOIN index_roots ON index_roots.id = related_entry.root_id
		JOIN media_metadata AS related_metadata ON related_metadata.content_id = related.content_id
			AND related_metadata.state = 'ready'
		CROSS JOIN entries AS fallback_entry INDEXED BY entries_by_photos_live_fallback
			ON fallback_entry.root_id = related_entry.root_id
			AND ${fallbackEntryParent} =
				substr(related_entry.relative_path, 1, length(related_entry.relative_path) - length(related_entry.name))
			AND ${fallbackEntryStem} = ${filenameStemSql('related_entry.name', PHOTO_MEDIA_EXTENSIONS)}
		JOIN media_metadata AS fallback_metadata ON fallback_metadata.content_id = fallback_entry.content_id
			AND fallback_metadata.state = 'ready'
		WHERE index_roots.owner_id = (SELECT account_id FROM requested_account)
			AND index_roots.kind IN ('home', 'trash')
			AND related_entry.type = 'file' AND related_entry.hidden = 0
			AND fallback_entry.type = 'file' AND fallback_entry.hidden = 0
			AND fallback_entry.thumbnail_identity_kind = 'content'
			AND ((related_metadata.kind = 'photo' AND fallback_metadata.kind = 'video'
					AND fallback_metadata.duration_ms <= 10000)
				OR (related_metadata.kind = 'video' AND related_metadata.duration_ms <= 10000
					AND fallback_metadata.kind = 'photo'))
	),
	relevant_contents(content_hash) AS MATERIALIZED (
		SELECT content_hash FROM requested_hashes
		UNION
		SELECT contents.blake3 FROM related_content_ids
		CROSS JOIN contents ON contents.id = related_content_ids.content_id
	),`
}

export function photoLibraryCte(targetHashCount = 0, stages: string[] = []) {
	const targeted = targetHashCount > 0
	const ctePrefix = targeted ? targetedPhotoContentCtes(targetHashCount) : 'WITH'
	const accountSql = targeted ? '(SELECT account_id FROM requested_account)' : '?'
	const indexedFromSql = targeted
		? `FROM relevant_contents
		CROSS JOIN contents INDEXED BY sqlite_autoindex_contents_1
			ON contents.blake3 = relevant_contents.content_hash
		CROSS JOIN entries INDEXED BY entries_by_content ON entries.content_id = contents.id
		JOIN index_roots ON index_roots.id = entries.root_id`
		: `FROM media_metadata
		CROSS JOIN entries INDEXED BY entries_by_content ON entries.content_id = media_metadata.content_id
		JOIN index_roots ON index_roots.id = entries.root_id
		JOIN contents ON contents.id = entries.content_id`
	return `
	${ctePrefix} indexed_locations AS ${targeted ? 'MATERIALIZED' : ''} (
		SELECT index_roots.owner_id AS account_id,
			index_roots.kind AS root_kind,
			contents.blake3 AS content_hash, lower(hex(contents.blake3)) AS id,
			contents.created_at AS content_created_at,
			entries.id AS entry_id, entries.content_id, entries.name, entries.search_name_folded,
			entries.size, entries.modified_ms, entries.birthtime_ms, entries.relative_path,
			index_roots.virtual_path AS root_virtual_path,
			media_metadata.kind, media_metadata.sub_kind, media_metadata.live_identifier, media_metadata.taken_at,
			media_metadata.taken_at_offset_minutes, media_metadata.created_at,
			media_metadata.width, media_metadata.height, media_metadata.duration_ms, media_metadata.tint,
			media_metadata.camera_make, media_metadata.camera_model, media_metadata.lens,
			media_metadata.focal_length, media_metadata.aperture, media_metadata.exposure,
			media_metadata.iso, media_metadata.latitude, media_metadata.longitude,
			media_metadata.altitude, media_metadata.user_comment, media_metadata.search_text,
			substr(entries.relative_path, 1, length(entries.relative_path) - length(entries.name))
				AS live_fallback_parent,
			${LIVE_FALLBACK_STEM_SQL} AS live_fallback_stem
		${indexedFromSql}
		${targeted ? 'JOIN media_metadata ON media_metadata.content_id = entries.content_id' : ''}
		WHERE media_metadata.state = 'ready' AND index_roots.owner_id = ${accountSql} AND index_roots.kind IN ('home', 'trash')
			AND entries.type = 'file' AND entries.hidden = 0
	),
	authorized_locations AS (${
		stages.includes('locations')
			? 'SELECT * FROM temp.photos_stage_locations'
			: `
		SELECT DISTINCT indexed_locations.*, iphone_source.id AS source_id,
			iphone_source.name AS source_name, iphone_source.type AS source_type
		FROM indexed_locations
		JOIN umbrel.photos_source_resources AS resource
			ON resource.account_id = indexed_locations.account_id
			AND resource.content_hash = indexed_locations.content_hash
		JOIN umbrel.photos_sources AS iphone_source ON iphone_source.id = resource.source_id
			AND iphone_source.account_id = resource.account_id AND iphone_source.type = 'iphone'
		UNION ALL
		SELECT indexed_locations.*, umbrel_source.id AS source_id,
			umbrel_source.name AS source_name, umbrel_source.type AS source_type
		FROM indexed_locations
		JOIN umbrel.photos_sources AS umbrel_source ON umbrel_source.account_id = indexed_locations.account_id
			AND umbrel_source.type = 'umbrel'
		WHERE (indexed_locations.root_kind = 'trash' OR
			${sourceScopeSql('umbrel_source', 'indexed_locations', 'indexed_locations', 'root_virtual_path')})
			AND NOT EXISTS (
				SELECT 1 FROM umbrel.photos_source_resources AS resource
				JOIN umbrel.photos_sources AS iphone_source ON iphone_source.id = resource.source_id
					AND iphone_source.account_id = resource.account_id AND iphone_source.type = 'iphone'
				WHERE resource.account_id = indexed_locations.account_id
					AND resource.content_hash = indexed_locations.content_hash
			)`
	}
	),
	ranked_locations AS (
		SELECT *, ROW_NUMBER() OVER (
			PARTITION BY content_hash, root_kind
			ORDER BY source_type = 'umbrel', source_id, root_virtual_path, relative_path
		) AS location_rank
		FROM authorized_locations
	),
	canonical_locations AS (
		SELECT * FROM ranked_locations WHERE location_rank = 1
	),
	ranked_exact_live_motions AS (
		SELECT account_id, live_identifier, content_hash, root_virtual_path, relative_path,
			ROW_NUMBER() OVER (
				PARTITION BY account_id, live_identifier
				ORDER BY root_virtual_path, relative_path, content_hash
			) AS motion_rank
		FROM authorized_locations
		WHERE kind = 'video' AND live_identifier IS NOT NULL
	),
	exact_live_motions AS (
		SELECT account_id, live_identifier, content_hash, root_virtual_path, relative_path
		FROM ranked_exact_live_motions WHERE motion_rank = 1
	),
	ranked_fallback_live_motions AS (
		SELECT account_id, root_virtual_path, live_fallback_parent, live_fallback_stem,
			content_hash, relative_path,
			ROW_NUMBER() OVER (
				PARTITION BY account_id, root_virtual_path, live_fallback_parent, live_fallback_stem
				ORDER BY relative_path, content_hash
			) AS motion_rank
		FROM authorized_locations
		WHERE kind = 'video' AND duration_ms <= 10000
	),
	fallback_live_motions AS (
		SELECT account_id, root_virtual_path, live_fallback_parent, live_fallback_stem,
			content_hash, relative_path
		FROM ranked_fallback_live_motions WHERE motion_rank = 1
	),
	live_pair_candidates AS (
		SELECT still.account_id, still.content_hash AS still_hash,
			motion.content_hash AS motion_hash, motion.root_virtual_path AS motion_root_virtual_path,
			motion.relative_path AS motion_relative_path, 0 AS match_rank
		FROM authorized_locations AS still
		JOIN exact_live_motions AS motion ON motion.account_id = still.account_id
			AND motion.live_identifier = still.live_identifier
		WHERE still.kind = 'photo' AND still.live_identifier IS NOT NULL

		UNION ALL

		SELECT still.account_id, still.content_hash AS still_hash,
			motion.content_hash AS motion_hash, motion.root_virtual_path AS motion_root_virtual_path,
			motion.relative_path AS motion_relative_path, 1 AS match_rank
		FROM authorized_locations AS still
		JOIN fallback_live_motions AS motion ON motion.account_id = still.account_id
			AND motion.root_virtual_path = still.root_virtual_path
			AND motion.live_fallback_parent = still.live_fallback_parent
			AND motion.live_fallback_stem = still.live_fallback_stem
		WHERE still.kind = 'photo'
	),
	ranked_live_pairs AS (
		SELECT *, ROW_NUMBER() OVER (
			PARTITION BY account_id, still_hash
			ORDER BY match_rank, motion_root_virtual_path, motion_relative_path, motion_hash
		) AS pair_rank
		FROM live_pair_candidates
	),
	derived_live_pairs AS (${
		stages.includes('pairs')
			? 'SELECT * FROM temp.photos_stage_pairs'
			: `
		SELECT account_id, still_hash, motion_hash
		FROM ranked_live_pairs WHERE pair_rank = 1`
	}
	),
	active_live_pairs AS (${
		stages.includes('active_pairs')
			? 'SELECT * FROM temp.photos_stage_active_pairs'
			: `
		SELECT pair.account_id, pair.still_hash, pair.motion_hash, location_kind.root_kind
		FROM derived_live_pairs AS pair
		CROSS JOIN (SELECT 'home' AS root_kind UNION ALL SELECT 'trash') AS location_kind
		WHERE EXISTS (
			SELECT 1 FROM authorized_locations AS still
			WHERE still.account_id = pair.account_id AND still.content_hash = pair.still_hash
				AND still.root_kind = location_kind.root_kind
		) AND EXISTS (
			SELECT 1 FROM authorized_locations AS motion
			WHERE motion.account_id = pair.account_id AND motion.content_hash = pair.motion_hash
				AND motion.root_kind = location_kind.root_kind
		)`
	}
	),
	logical_items AS (
		SELECT canonical_locations.*,
			COALESCE(umbrel.photos_content_state.is_favorite, 0) AS is_favorite,
			COALESCE(umbrel.photos_content_state.imported_at, canonical_locations.content_created_at) AS imported_at,
			COALESCE(canonical_locations.taken_at, umbrel.photos_content_state.source_created_at,
				canonical_locations.birthtime_ms,
				canonical_locations.modified_ms) AS logical_taken_at,
			COALESCE(canonical_locations.created_at, umbrel.photos_content_state.source_created_at,
				canonical_locations.birthtime_ms,
				canonical_locations.modified_ms) AS logical_created_at,
			CASE
				WHEN canonical_locations.sub_kind = 'spherical' THEN 'spherical'
				WHEN live_pair.still_hash IS NOT NULL OR canonical_locations.sub_kind = 'live' THEN 'live'
				WHEN lower(canonical_locations.name) LIKE 'screenshot%'
					OR lower(canonical_locations.name) LIKE 'screen shot%'
					OR lower(canonical_locations.user_comment) LIKE '%screenshot%'
					OR lower(canonical_locations.user_comment) LIKE '%screen shot%'
					OR (lower(canonical_locations.name) GLOB '*.png'
						AND canonical_locations.camera_make IS NULL AND canonical_locations.camera_model IS NULL)
				THEN 'screenshot'
				WHEN canonical_locations.sub_kind IS NOT NULL THEN canonical_locations.sub_kind
				ELSE NULL
			END AS logical_sub_kind
		FROM canonical_locations
		LEFT JOIN umbrel.photos_content_state ON umbrel.photos_content_state.account_id = canonical_locations.account_id
			AND umbrel.photos_content_state.content_hash = canonical_locations.content_hash
		LEFT JOIN active_live_pairs AS live_pair ON live_pair.account_id = canonical_locations.account_id
			AND live_pair.still_hash = canonical_locations.content_hash
			AND live_pair.root_kind = canonical_locations.root_kind
		WHERE NOT EXISTS (
			SELECT 1 FROM active_live_pairs AS hidden_motion
			WHERE hidden_motion.account_id = canonical_locations.account_id
				AND hidden_motion.motion_hash = canonical_locations.content_hash
				AND hidden_motion.root_kind = canonical_locations.root_kind
		)
	)`
}

export function sourceScopeSql(
	source = 'umbrel.photos_sources',
	root = 'index_roots',
	entry = 'entries',
	rootVirtualPathColumn = 'virtual_path',
) {
	const virtualPath = `(${root}.${rootVirtualPathColumn} || '/' || ${entry}.relative_path)`
	const containsPath = `${virtualPath} = value OR (${virtualPath} >= value || '/' AND ${virtualPath} < value || '0')`
	return `(
		${source}.scope_mode IS NULL OR ${source}.scope_mode = 'everything'
		OR (${source}.scope_mode = 'only' AND EXISTS (
			SELECT 1 FROM json_each(${source}.scope_paths) WHERE ${containsPath}
		))
		OR (${source}.scope_mode = 'everything-except' AND NOT EXISTS (
			SELECT 1 FROM json_each(${source}.scope_paths) WHERE ${containsPath}
		))
	)`
}

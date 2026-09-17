import type DatabaseTypes from 'better-sqlite3'

import {photoLibraryCte as rawPhotoLibraryCte} from './library-sql.js'

type Database = DatabaseTypes.Database
const BATCH_SIZE = 128
const sets = [
	['locations', 'authorized_locations'],
	['pairs', 'derived_live_pairs'],
	['active_pairs', 'active_live_pairs'],
	['items', 'logical_items'],
] as const

// These CTEs provide account-scoped names for existing query expressions. They
// are ordinary indexed tables: no authorization, ranking or pairing runs here.
export function photoLibraryCte(count = 0, details = false, lookupByHash = false) {
	return `WITH ${
		count
			? `requested_values(content_hash) AS (VALUES ${Array.from({length: count}, () => '(?)').join(',')}),
	requested_hashes AS (SELECT DISTINCT content_hash FROM requested_values WHERE content_hash IS NOT NULL),`
			: ''
	}
	requested_account(account_id) AS (VALUES (?)),
	authorized_locations AS (SELECT * FROM photos_library_locations WHERE account_id = (SELECT account_id FROM requested_account)),
	derived_live_pairs AS (SELECT * FROM photos_library_pairs WHERE account_id = (SELECT account_id FROM requested_account)),
	active_live_pairs AS (SELECT * FROM photos_library_active_pairs WHERE account_id = (SELECT account_id FROM requested_account)),
	logical_items AS (SELECT item.* ${
		details
			? `, metadata.camera_make, metadata.camera_model, metadata.lens,
		metadata.focal_length, metadata.aperture, metadata.exposure, metadata.iso,
		metadata.latitude, metadata.longitude, metadata.altitude, metadata.user_comment`
			: ''
	}
		FROM photos_library_items AS item ${lookupByHash ? 'INDEXED BY photos_library_items_key' : ''}
		${details ? 'LEFT JOIN media_metadata AS metadata ON metadata.content_id = item.content_id' : ''}
		WHERE item.account_id = (SELECT account_id FROM requested_account))`
}

export default class PhotosReadModel {
	#statements = new WeakMap<Database, Map<string, DatabaseTypes.Statement>>()

	#prepare(database: Database, sql: string) {
		let statements = this.#statements.get(database)
		if (!statements) this.#statements.set(database, (statements = new Map()))
		let statement = statements.get(sql)
		if (!statement) statements.set(sql, (statement = database.prepare(sql)))
		return statement
	}

	// Old selected pairs remain available after metadata/path changes. Walk them
	// together with the current exact-ID/fallback graph until it stops growing.
	// This also preserves peers of a deleted content row, whose hash can no
	// longer be resolved through contents.
	dependencies(database: Database, accountId: string, hashes: Buffer[]) {
		const known = new Map(hashes.map((hash) => [hash.toString('hex'), hash]))
		let pending = [...known.values()]
		const expanded = new Set<string>()
		while (pending.length) {
			const batch = pending.splice(0, BATCH_SIZE)
			let capacity = 1
			while (capacity < batch.length) capacity *= 2
			const parameters = [...batch, ...Array<null>(capacity - batch.length).fill(null), accountId]
			const rows = this.#prepare(
				database,
				`${rawPhotoLibraryCte(capacity)}
				SELECT content_hash, 1 AS expanded FROM relevant_contents
				UNION SELECT motion_hash, 0 FROM photos_library_pairs
				WHERE account_id = (SELECT account_id FROM requested_account)
					AND still_hash IN (SELECT content_hash FROM relevant_contents)
				UNION SELECT still_hash, 0 FROM photos_library_pairs
				WHERE account_id = (SELECT account_id FROM requested_account)
					AND motion_hash IN (SELECT content_hash FROM relevant_contents)`,
			).all(...parameters) as Array<{content_hash: Buffer; expanded: number}>
			// The recursive query already expanded every raw peer and examined
			// their old pair edges. Revisit only peers reached solely by old edges.
			for (const row of rows) if (row.expanded) expanded.add(row.content_hash.toString('hex'))
			for (const {content_hash: hash} of rows) {
				if (known.has(hash.toString('hex'))) continue
				known.set(hash.toString('hex'), hash)
				if (!expanded.has(hash.toString('hex'))) pending.push(hash)
			}
			pending = pending.filter((hash) => !expanded.has(hash.toString('hex')))
		}
		return [...known.values()]
	}

	refresh(database: Database, accountId: string, hashes?: Buffer[]) {
		// Call inside the same transaction as the indexed/durable mutation. TEMP
		// staging bounds intermediate work without storing a second EXIF copy.
		if (!database.prepare("SELECT 1 FROM sqlite_temp_schema WHERE name = 'photos_stage_hashes'").get()) {
			for (const [name, cte] of sets) {
				database
					.prepare(
						`CREATE TEMP TABLE photos_stage_${name} AS
					${rawPhotoLibraryCte()} SELECT * FROM ${cte} WHERE 0`,
					)
					.run(accountId)
			}
			database.exec('CREATE TEMP TABLE photos_stage_hashes(content_hash BLOB PRIMARY KEY)')
		}
		const affected = hashes ? this.dependencies(database, accountId, hashes) : undefined
		if (affected?.length === 0) return
		// Expand the whole component before replacing pairs; batches must not
		// lose the pre-change dependencies needed by a subsequent batch.
		const remaining = affected ? new Map(affected.map((hash) => [hash.toString('hex'), hash])) : undefined
		do {
			const batch = remaining ? [...remaining.values()].slice(0, BATCH_SIZE) : undefined
			const stages: string[] = []
			let capacity = 0
			if (batch) {
				capacity = 1
				while (capacity < batch.length) capacity *= 2
			}
			const parameters = [...(batch ?? []), ...Array<null>(capacity - (batch?.length ?? 0)).fill(null), accountId]
			for (const [name, cte] of sets) {
				database.exec(`DELETE FROM temp.photos_stage_${name}`)
				this.#prepare(
					database,
					`INSERT INTO temp.photos_stage_${name}
					${rawPhotoLibraryCte(capacity, stages)} SELECT * FROM ${cte}`,
				).run(...parameters)
				stages.push(name)
			}
			database.exec('DELETE FROM temp.photos_stage_hashes')
			if (batch) {
				const insert = this.#prepare(database, 'INSERT OR IGNORE INTO temp.photos_stage_hashes VALUES (?)')
				// The raw projection may include peers outside this batch. Replace
				// that complete result together, including invisible motion rows.
				const rows = this.#prepare(
					database,
					`${rawPhotoLibraryCte(capacity)} SELECT content_hash FROM relevant_contents`,
				).all(...parameters) as Array<{content_hash: Buffer}>
				for (const {content_hash} of rows) {
					insert.run(content_hash)
					// A batch can project a much larger Live Photo component. Do not
					// recompute that component once for every remaining seed batch.
					remaining!.delete(content_hash.toString('hex'))
				}
			}
			for (const [name] of sets) {
				const key = name === 'pairs' || name === 'active_pairs' ? 'still_hash' : 'content_hash'
				this.#prepare(
					database,
					`DELETE FROM photos_library_${name} WHERE account_id = ?
					${batch ? `AND ${key} IN (SELECT content_hash FROM temp.photos_stage_hashes)` : ''}`,
				).run(accountId)
				const columns = (database.prepare(`PRAGMA table_info(photos_library_${name})`).all() as Array<{name: string}>)
					.map(({name}) => name)
					.join(',')
				this.#prepare(
					database,
					`INSERT INTO photos_library_${name}(${columns}) SELECT ${columns} FROM temp.photos_stage_${name}`,
				).run()
			}
			this.#prepare(
				database,
				`UPDATE umbrel.photos_content_state AS state SET effective_taken_at = (
				SELECT logical_taken_at FROM photos_library_items
				WHERE account_id = state.account_id AND content_hash = state.content_hash AND root_kind = 'home')
				WHERE account_id = ? ${batch ? 'AND content_hash IN (SELECT content_hash FROM temp.photos_stage_hashes)' : ''}`,
			).run(accountId)
			for (const schema of ['main', 'umbrel']) {
				this.#prepare(
					database,
					`DELETE FROM ${schema}.photos_read_model_dirty_contents WHERE account_id = ?
					${batch ? 'AND content_hash IN (SELECT content_hash FROM temp.photos_stage_hashes)' : ''}`,
				).run(accountId)
				if (!batch)
					this.#prepare(database, `DELETE FROM ${schema}.photos_read_model_dirty_accounts WHERE account_id = ?`).run(
						accountId,
					)
			}
		} while (remaining?.size)
	}

	removeAccount(database: Database, accountId: string) {
		this.#prepare(
			database,
			'UPDATE umbrel.photos_content_state SET effective_taken_at = NULL WHERE account_id = ?',
		).run(accountId)
		for (const [name] of sets)
			this.#prepare(database, `DELETE FROM photos_library_${name} WHERE account_id = ?`).run(accountId)
		for (const schema of ['main', 'umbrel']) {
			for (const kind of ['contents', 'accounts'])
				this.#prepare(database, `DELETE FROM ${schema}.photos_read_model_dirty_${kind} WHERE account_id = ?`).run(
					accountId,
				)
		}
	}
}

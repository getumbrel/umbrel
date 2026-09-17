import BetterSqlite3 from 'better-sqlite3'

import PhotosRepository from '../../photos/repository.js'
import type {PhotoFilter} from '../../photos/types.js'
import {fileIndexQueries} from './queries.js'
import type {ReadLane, SqlRead} from './read-database.js'

export type PhotosReadMethod =
	| 'summary'
	| 'indexingState'
	| 'listItems'
	| 'getItem'
	| 'neighbors'
	| 'resolveItems'
	| 'resolveItemFiles'
	| 'resolveLiveCompanion'
	| 'listAlbums'
	| 'listSources'

type RepositoryReadMethod = PhotosReadMethod | 'accountIdsForContent' | 'accountIdsForEntry'
type ReadMethods = Pick<PhotosRepository, RepositoryReadMethod> &
	typeof fileIndexQueries & {
		sql: (database: BetterSqlite3.Database, query: SqlRead) => unknown
	}
export type FileIndexReadMethod = keyof ReadMethods
export type FileIndexReadArgs<M extends FileIndexReadMethod> =
	Parameters<ReadMethods[M]> extends [unknown, ...infer Args] ? Args : never
export type FileIndexReadResult<M extends FileIndexReadMethod> = ReturnType<ReadMethods[M]>
export type FileIndexReaderPaths = {databasePath: string; umbrelDatabasePath: string}

export function isPhotosRead(method: FileIndexReadMethod): method is PhotosReadMethod {
	return (
		method !== 'sql' &&
		method !== 'accountIdsForContent' &&
		method !== 'accountIdsForEntry' &&
		!(method in fileIndexQueries)
	)
}

// Explicit cost classes keep heavy scans away from thumbnail and item
// lookups. These are conservative query shapes, not runtime latency guesses.
export function readLane(method: FileIndexReadMethod, args: unknown[]): ReadLane {
	// Album listing aggregates memberships and selects covers across every album.
	if (['searchCandidates', 'directorySizes', 'summary', 'listSources', 'listAlbums'].includes(method)) return 'bulk'
	if (method === 'listItems' || method === 'neighbors') {
		const filter = args[method === 'listItems' ? 1 : 2] as PhotoFilter
		if (filter.query) return 'bulk'
		// Unlike paged lists, these neighbor queries materialize the filtered collection.
		if (method === 'neighbors' && (filter.albumIds?.length || filter.sourceIds?.length)) return 'bulk'
	}
	if (method === 'resolveItemFiles' && (!args[1] || (args[1] as string[]).length > 200)) return 'bulk'
	if (method === 'resolveItems' && (args[1] as string[]).length > 200) return 'bulk'
	return 'interactive'
}

// Each worker owns its connections and prepared statements. Both database
// files are opened read-only; query_only also rejects accidental temp writes.
export default class FileIndexReader {
	#database: BetterSqlite3.Database
	#repository = new PhotosRepository({readonly: true})
	#umbrelDatabasePath: string
	#attached = false
	#statements = new Map<string, BetterSqlite3.Statement>()

	constructor({databasePath, umbrelDatabasePath}: FileIndexReaderPaths) {
		this.#umbrelDatabasePath = umbrelDatabasePath
		this.#database = new BetterSqlite3(databasePath, {readonly: true, fileMustExist: true, timeout: 5000})
		try {
			this.#database.pragma('query_only = ON')
		} catch (error) {
			this.#database.close()
			throw error
		}
	}

	beginSnapshot(photos = true) {
		if (photos && !this.#attached) {
			// Files reads remain available even when the Photos database is unavailable.
			// ATTACH inherits SQLITE_OPEN_READONLY from the main connection.
			this.#database.prepare('ATTACH DATABASE ? AS umbrel').run(this.#umbrelDatabasePath)
			this.#attached = true
		}
		this.#database.exec('BEGIN')
		try {
			// This reads both attached files, pinning their WAL snapshots while the
			// writer still holds its mutation queue. BEGIN alone would not do that.
			if (photos) this.#repository.syncPendingChanges(this.#database)
		} catch (error) {
			this.endSnapshot()
			throw error
		}
	}

	read<M extends FileIndexReadMethod>(method: M, args: FileIndexReadArgs<M>): FileIndexReadResult<M> {
		if (!this.#database.inTransaction) throw new Error('File index reader requires a snapshot')
		if (method === 'sql') {
			const {sql, parameters, all} = args[0] as SqlRead
			let statement = this.#statements.get(sql)
			if (!statement) {
				statement = this.#database.prepare(sql)
				if (!statement.readonly) throw new Error('Reader SQL must be read-only')
				// Dynamic IN lists must not grow each worker's statement cache forever.
				if (this.#statements.size >= 128) this.#statements.delete(this.#statements.keys().next().value!)
				this.#statements.set(sql, statement)
			}
			return statement[all ? 'all' : 'get'](...parameters) as FileIndexReadResult<M>
		}
		if (method in fileIndexQueries) {
			const read = fileIndexQueries[method as keyof typeof fileIndexQueries] as (
				database: BetterSqlite3.Database,
				...args: unknown[]
			) => unknown
			return read(this.#database, ...args) as FileIndexReadResult<M>
		}
		const read = this.#repository[method as RepositoryReadMethod] as (
			database: BetterSqlite3.Database,
			...args: unknown[]
		) => unknown
		return read.call(this.#repository, this.#database, ...args) as FileIndexReadResult<M>
	}

	endSnapshot() {
		if (this.#database.inTransaction) this.#database.exec('ROLLBACK')
	}

	close() {
		this.#database.close()
	}
}

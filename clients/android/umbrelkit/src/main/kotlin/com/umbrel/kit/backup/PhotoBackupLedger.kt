package com.umbrel.kit.backup

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.AndroidSQLiteDriver
import androidx.sqlite.execSQL
import java.io.File

/**
 * The durable upload queue and receipt store, a port of the iOS PhotoBackupLedger. Rows are
 * keyed by (backup source id, MediaStore item URI). Assets are revisioned so an edited photo
 * is uploaded again under a new resource key while the previous receipt is kept. Unlike
 * iOS, which versions an asset by PhotoKit's modification date, a revision here is the
 * MediaStore SIZE of the content plus the generation at which that content was first seen.
 *
 * Uses the androidx.sqlite driver API over the platform SQLite (no bundled native code),
 * with WAL and a busy timeout so the worker and the UI can each hold a connection.
 * Every method is blocking; callers move it off the main thread.
 */
class PhotoBackupLedger(file: File) : AutoCloseable {
	/**
	 * UNREADABLE is an item MediaStore still lists but that couldn't be opened or read. It is
	 * tried again on later passes and never counts as deleted.
	 */
	enum class AssetState(val raw: Long) { PENDING(0), PREPARED(1), UPLOADED(2), FAILED(3), DELETED(4), UNREADABLE(5) }

	class DatabaseException(message: String) : Exception(message)

	/** A server-controlled byte count outside 1 B to 1 TiB is never recorded. */
	class InvalidByteCountException : IllegalArgumentException("Invalid photo backup byte count")

	/**
	 * One visible MediaStore row: its SIZE, its generation (the later of GENERATION_MODIFIED
	 * and GENERATION_ADDED), and its folder key from [PhotoBackupFolders.key].
	 */
	data class AssetCandidate(
		val localIdentifier: String,
		val mediaType: Long,
		val creationDateMs: Long,
		val size: Long,
		val generation: Long,
		val folder: String = "",
	)

	data class AssetWork(
		val localIdentifier: String,
		val mediaType: Long,
		val revision: Long,
		val creationDateMs: Long,
		val contentSize: Long,
		val contentGeneration: Long,
	)

	data class AssetRecord(val state: AssetState, val uploadedBytes: Long)

	/**
	 * A full inventory in progress. Each media type is read in pages of descending MediaStore
	 * ids; a cursor is the id the next page starts below, null before the first page and
	 * [INVENTORY_FINISHED] after the last.
	 */
	data class InventoryScan(val generation: Long, val changeToken: String, val imageCursor: Long? = null, val videoCursor: Long? = null) {
		fun cursor(mediaType: Long): Long? = if (mediaType == MEDIA_TYPE_VIDEO) videoCursor else imageCursor
	}

	data class ResourcePlan(val resourceKey: String, val filename: String, val destinationPath: String)

	data class ResourceWork(val resourceKey: String, val filename: String, val destinationPath: String, val state: Long)

	data class ResourceReceiptQuery(val resourceKey: String, val fileExtension: String)

	data class ResourceReceipt(val resourceKey: String, val bytes: Long)

	private val connection: SQLiteConnection = AndroidSQLiteDriver().open(file.also { it.parentFile?.mkdirs() }.absolutePath)
	private val lock = Any()

	init {
		try {
			connection.execSQL("PRAGMA busy_timeout = 5000")
			val openedVersion = integer("PRAGMA user_version")
			validateSchemaVersion(openedVersion)
			// Android sets each connection it opens back to its default journal mode unless that
			// connection asks for WAL, and the switch takes whenever no other connection has the
			// file open, so every open asks, as Room does. The driver turns this into
			// enableWriteAheadLogging, which also gives Android's WAL sync mode.
			text("PRAGMA journal_mode = WAL")
			transaction {
				val storedVersion = integer("PRAGMA user_version")
				validateSchemaVersion(storedVersion)
				if (storedVersion == 4L || storedVersion == 5L) {
					if (storedVersion == 4L) migrateFromVersion4()
					migrateFromVersion5()
					connection.execSQL("PRAGMA user_version = $SCHEMA_VERSION")
				} else if (storedVersion != SCHEMA_VERSION) {
					// Only development builds wrote a schema before 4. Its rows are rebuilt by
					// the next full inventory rather than migrated.
					if (storedVersion != 0L) dropSchema()
					createSchema()
					connection.execSQL("PRAGMA user_version = $SCHEMA_VERSION")
				}
			}
		} catch (error: Exception) {
			connection.close()
			throw error
		}
	}

	private fun createSchema() {
		connection.execSQL(
			"""
			CREATE TABLE IF NOT EXISTS photo_assets (
				deviceId TEXT NOT NULL,
				localIdentifier TEXT NOT NULL,
				mediaType INTEGER NOT NULL,
				revision INTEGER NOT NULL DEFAULT 1,
				state INTEGER NOT NULL,
				creationDate REAL NOT NULL,
				contentSize INTEGER NOT NULL,
				contentGeneration INTEGER NOT NULL,
				inventoryGeneration INTEGER NOT NULL DEFAULT 0,
				expectedResources INTEGER NOT NULL DEFAULT 0,
				uploadedBytes INTEGER NOT NULL DEFAULT 0,
				uploadedAt REAL,
				lastError TEXT,
				folder TEXT,
				interruptions INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (deviceId, localIdentifier)
			)
			""".trimIndent(),
		)
		connection.execSQL(
			"""
			CREATE TABLE IF NOT EXISTS photo_resources (
				resourceKey TEXT PRIMARY KEY,
				deviceId TEXT NOT NULL,
				localIdentifier TEXT NOT NULL,
				revision INTEGER NOT NULL,
				filename TEXT NOT NULL,
				destinationPath TEXT NOT NULL,
				state INTEGER NOT NULL,
				bytes INTEGER NOT NULL DEFAULT 0,
				attempts INTEGER NOT NULL DEFAULT 0,
				lastError TEXT
			)
			""".trimIndent(),
		)
		connection.execSQL("CREATE INDEX IF NOT EXISTS photo_resources_asset ON photo_resources (deviceId, localIdentifier, revision)")
		connection.execSQL(
			"CREATE INDEX IF NOT EXISTS photo_assets_work ON photo_assets (deviceId, creationDate DESC, mediaType) " +
				"WHERE state IN (${AssetState.PENDING.raw}, ${AssetState.PREPARED.raw}, ${AssetState.UNREADABLE.raw})",
		)
		connection.execSQL(
			"CREATE TABLE IF NOT EXISTS photo_inventory_scans (deviceId TEXT PRIMARY KEY, generation INTEGER NOT NULL, " +
				"changeToken BLOB NOT NULL, imageCursor INTEGER, videoCursor INTEGER)",
		)
		connection.execSQL(
			"CREATE TABLE IF NOT EXISTS photo_metadata (deviceId TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (deviceId, key))",
		)
	}

	/**
	 * Version 4 didn't record folders. The column starts NULL, an unknown folder that is never
	 * skipped, and forgetting the change tokens makes the next pass a full inventory, which
	 * records every item's folder while keeping its receipts.
	 */
	private fun migrateFromVersion4() {
		connection.execSQL("ALTER TABLE photo_assets ADD COLUMN folder TEXT")
		execute("DELETE FROM photo_metadata WHERE key = ?", CHANGE_TOKEN_KEY)
		connection.execSQL("DELETE FROM photo_inventory_scans")
	}

	/** Version 5 didn't record uploads that were cut off; every item starts with none. */
	private fun migrateFromVersion5() {
		connection.execSQL("ALTER TABLE photo_assets ADD COLUMN interruptions INTEGER NOT NULL DEFAULT 0")
	}

	private fun dropSchema() {
		for (table in listOf("photo_assets", "photo_resources", "photo_inventory_scans", "photo_metadata")) {
			connection.execSQL("DROP TABLE IF EXISTS $table")
		}
	}

	// The app and the worker share this file. Refuse a schema written by newer code instead
	// of interpreting it incorrectly.
	private fun validateSchemaVersion(version: Long) {
		if (version > SCHEMA_VERSION) throw DatabaseException("Unsupported photo backup schema version $version")
	}

	// ── Inventory ──

	/**
	 * A full inventory is durably checkpointed and may span several worker runs. The
	 * MediaStore change token is captured before the first batch and committed only after
	 * the last, so every change that raced the scan is replayed incrementally afterwards.
	 */
	fun startInventoryScan(sourceId: String, changeToken: String): InventoryScan = synchronized(lock) {
		inventoryScanLocked(sourceId)?.let { return it }
		transaction {
			val generation = nextInventoryGenerationLocked(sourceId)
			execute("INSERT INTO photo_inventory_scans (deviceId, generation, changeToken) VALUES (?, ?, ?)", sourceId, generation, changeToken.toByteArray())
			InventoryScan(generation, changeToken)
		}
	}

	/**
	 * Records one page of a resumable scan and moves that media type's cursor to [next] (null
	 * after the last page) in the same transaction, so a resumed scan reads each row once.
	 */
	fun recordInventoryBatch(candidates: List<AssetCandidate>, sourceId: String, generation: Long, mediaType: Long, next: Long?) = synchronized(lock) {
		transaction {
			if (inventoryScanLocked(sourceId)?.generation != generation) {
				throw DatabaseException("Photo backup inventory scan is no longer current")
			}
			for (candidate in candidates) seedCandidateLocked(candidate, sourceId, generation)
			val column = if (mediaType == MEDIA_TYPE_VIDEO) "videoCursor" else "imageCursor"
			execute("UPDATE photo_inventory_scans SET $column = ? WHERE deviceId = ?", next ?: INVENTORY_FINISHED, sourceId)
		}
	}

	/** Anything this scan did not record no longer exists in the library. */
	fun finishInventoryScan(sourceId: String, generation: Long) = synchronized(lock) {
		transaction {
			val scan = inventoryScanLocked(sourceId)
			if (scan == null || scan.generation != generation) throw DatabaseException("Photo backup inventory scan is no longer current")
			execute(
				"UPDATE photo_assets SET state = ?, lastError = NULL WHERE deviceId = ? AND inventoryGeneration != ?",
				AssetState.DELETED.raw, sourceId, generation,
			)
			setMetadataLocked(scan.changeToken, CHANGE_TOKEN_KEY, sourceId)
			execute("DELETE FROM photo_inventory_scans WHERE deviceId = ?", sourceId)
		}
	}

	fun inventoryScan(sourceId: String): InventoryScan? = synchronized(lock) { inventoryScanLocked(sourceId) }

	/** Applies one incremental batch of library changes, then advances the change token. */
	fun applyChanges(upserted: List<AssetCandidate>, deleted: Set<String>, sourceId: String, changeToken: String?) = synchronized(lock) {
		transaction {
			for (candidate in upserted) seedCandidateLocked(candidate, sourceId, null)
			for (identifier in deleted) markDeletedLocked(sourceId, identifier)
			if (changeToken != null) setMetadataLocked(changeToken, CHANGE_TOKEN_KEY, sourceId)
		}
	}

	fun changeToken(sourceId: String): String? = synchronized(lock) {
		query("SELECT value FROM photo_metadata WHERE deviceId = ? AND key = ?", sourceId, CHANGE_TOKEN_KEY) {
			if (it.step()) String(it.getBlob(0), Charsets.UTF_8) else null
		}
	}

	/** Forgets the token and any scan in progress, so the next pass starts a full inventory. */
	fun clearChangeToken(sourceId: String) = synchronized(lock) {
		transaction {
			execute("DELETE FROM photo_metadata WHERE deviceId = ? AND key = ?", sourceId, CHANGE_TOKEN_KEY)
			execute("DELETE FROM photo_inventory_scans WHERE deviceId = ?", sourceId)
		}
	}

	/** Assets of [mediaType] the ledger believes are still in the library. */
	fun presentAssetCount(sourceId: String, mediaType: Long): Long = synchronized(lock) {
		query("SELECT COUNT(*) FROM photo_assets WHERE deviceId = ? AND mediaType = ? AND state != ?", sourceId, mediaType, AssetState.DELETED.raw) {
			it.step()
			it.getLong(0)
		}
	}

	// ── Candidacy ──

	/**
	 * Marks an upload as started; [uploadFinished] clears the mark. A mark that outlives its
	 * pass means the upload was cut off: by a regular job's 10-minute limit, a stop, or the
	 * process dying. A file too large to upload within one job is cut off every time and
	 * restarts from zero, so it goes behind the rest of the queue instead of holding up
	 * everything older than it, and gets its turn once nothing else is waiting.
	 */
	fun uploadStarted(sourceId: String, localIdentifier: String) = synchronized(lock) {
		execute("UPDATE photo_assets SET interruptions = interruptions + 1 WHERE deviceId = ? AND localIdentifier = ?", sourceId, localIdentifier)
	}

	/** The upload got an answer, whatever it was, so the item fits in a pass. */
	fun uploadFinished(sourceId: String, localIdentifier: String) = synchronized(lock) {
		execute("UPDATE photo_assets SET interruptions = 0 WHERE deviceId = ? AND localIdentifier = ?", sourceId, localIdentifier)
	}

	/**
	 * Visible minus uploaded minus queued, newest first, with unreadable items tried again.
	 * An item whose last upload was cut off goes behind the rest (see [uploadStarted]).
	 */
	fun nextAssets(sourceId: String, includePhotos: Boolean, includeVideos: Boolean, limit: Int, skippedFolders: Set<String> = emptySet()): List<AssetWork> {
		val mediaTypes = mediaTypes(includePhotos, includeVideos)
		if (mediaTypes.isEmpty() || limit <= 0) return emptyList()
		return synchronized(lock) {
			query(
				"""
				SELECT asset.localIdentifier, asset.mediaType, asset.revision, asset.creationDate, asset.contentSize, asset.contentGeneration
				FROM photo_assets AS asset
				WHERE asset.deviceId = ?
					AND asset.mediaType IN (${placeholders(mediaTypes.size)})
					AND ${backedUpFolder("asset", skippedFolders)}
					AND asset.state IN (${AssetState.PENDING.raw}, ${AssetState.PREPARED.raw}, ${AssetState.UNREADABLE.raw})
					AND (
						asset.state != ?
						OR (
							asset.state = ?
							AND EXISTS (
								SELECT 1 FROM photo_resources AS resource
								WHERE resource.deviceId = asset.deviceId
									AND resource.localIdentifier = asset.localIdentifier
									AND resource.revision = asset.revision
									AND resource.state = ?
							)
						)
					)
				ORDER BY asset.interruptions, asset.creationDate DESC
				LIMIT ?
				""".trimIndent(),
				sourceId, *mediaTypes.toTypedArray(), *skippedFolders.toTypedArray(), AssetState.PREPARED.raw, AssetState.PREPARED.raw, RESOURCE_PENDING, limit.toLong(),
			) { statement ->
				buildList {
					while (statement.step()) {
						add(
							AssetWork(
								localIdentifier = statement.getText(0),
								mediaType = statement.getLong(1),
								revision = statement.getLong(2),
								creationDateMs = millis(statement.getDouble(3)),
								contentSize = statement.getLong(4),
								contentGeneration = statement.getLong(5),
							),
						)
					}
				}
			}
		}
	}

	/**
	 * Registers the resources planned for one asset revision. A plan for a revision that an
	 * edit or deletion has already replaced is ignored.
	 */
	fun prepareAsset(sourceId: String, localIdentifier: String, revision: Long, resources: List<ResourcePlan>) = synchronized(lock) {
		transaction {
			execute(
				"UPDATE photo_assets SET state = ?, expectedResources = ?, lastError = NULL " +
					"WHERE deviceId = ? AND localIdentifier = ? AND revision = ? AND state IN (?, ?, ?)",
				AssetState.PREPARED.raw, resources.size.toLong(), sourceId, localIdentifier, revision,
				AssetState.PENDING.raw, AssetState.PREPARED.raw, AssetState.UNREADABLE.raw,
			)
			if (changes() != 1L) return@transaction
			for (resource in resources) {
				execute(
					"INSERT OR IGNORE INTO photo_resources (resourceKey, deviceId, localIdentifier, revision, filename, destinationPath, state) " +
						"VALUES (?, ?, ?, ?, ?, ?, ?)",
					resource.resourceKey, sourceId, localIdentifier, revision, resource.filename, resource.destinationPath, RESOURCE_PENDING,
				)
			}
		}
	}

	fun resources(sourceId: String, localIdentifier: String, revision: Long): List<ResourceWork> = synchronized(lock) {
		query(
			"SELECT resourceKey, filename, destinationPath, state FROM photo_resources " +
				"WHERE deviceId = ? AND localIdentifier = ? AND revision = ? ORDER BY rowid",
			sourceId, localIdentifier, revision,
		) { statement ->
			buildList {
				while (statement.step()) {
					add(ResourceWork(statement.getText(0), statement.getText(1), statement.getText(2), statement.getLong(3)))
				}
			}
		}
	}

	/**
	 * Only resources of a prepared current revision can already be on the server without a
	 * local receipt (the response was lost). The bounded query keeps reconciliation
	 * independent of library size.
	 */
	fun unconfirmedResourceReceipts(sourceId: String, includePhotos: Boolean, includeVideos: Boolean, limit: Int = 256): List<ResourceReceiptQuery> {
		val mediaTypes = mediaTypes(includePhotos, includeVideos)
		if (mediaTypes.isEmpty() || limit <= 0) return emptyList()
		return synchronized(lock) {
			query(
				"""
				SELECT resource.resourceKey, resource.destinationPath
				FROM photo_resources AS resource
				JOIN photo_assets AS asset ON asset.deviceId = resource.deviceId AND asset.localIdentifier = resource.localIdentifier
				WHERE resource.deviceId = ?
					AND resource.revision = asset.revision
					AND asset.state = ?
					AND resource.state != ?
					AND asset.mediaType IN (${placeholders(mediaTypes.size)})
				ORDER BY asset.rowid, resource.rowid
				LIMIT ?
				""".trimIndent(),
				sourceId, AssetState.PREPARED.raw, RESOURCE_SUCCEEDED, *mediaTypes.toTypedArray(), minOf(limit, 256).toLong(),
			) { statement ->
				buildList {
					while (statement.step()) {
						val fileExtension = statement.getText(1).substringAfterLast('/').substringAfterLast('.', "").lowercase()
						if (fileExtension.isNotEmpty()) add(ResourceReceiptQuery(statement.getText(0), fileExtension))
					}
				}
			}
		}
	}

	fun recordResourceSucceeded(resourceKey: String, bytes: Long) {
		if (!isValidResourceByteCount(bytes)) throw InvalidByteCountException()
		synchronized(lock) { transaction { recordResourceSucceededLocked(resourceKey, bytes) } }
	}

	/**
	 * Records receipts Umbrel confirmed for resources whose upload response was lost. All
	 * receipts are validated before any is written.
	 */
	fun recordConfirmedResources(receipts: List<ResourceReceipt>) {
		if (receipts.isEmpty()) return
		if (!receipts.all { isValidResourceByteCount(it.bytes) }) throw InvalidByteCountException()
		synchronized(lock) {
			transaction { for (receipt in receipts) recordResourceSucceededLocked(receipt.resourceKey, receipt.bytes) }
		}
	}

	/** A later transport failure never revokes a resource the server already confirmed. */
	fun recordResourceFailed(resourceKey: String, message: String) = synchronized(lock) {
		transaction {
			val owner = resourceOwnerLocked(resourceKey) ?: return@transaction
			execute(
				"UPDATE photo_resources SET state = ?, lastError = ? WHERE resourceKey = ? AND state != ?",
				RESOURCE_FAILED, message, resourceKey, RESOURCE_SUCCEEDED,
			)
			refreshAssetOutcomeLocked(owner)
		}
	}

	/**
	 * A failure that may not be the item's fault, such as a server error or a lost answer,
	 * returns the resource to the queue and counts toward [limit]. Reaching it marks the
	 * resource failed, which only the user's Try Again requeues. Returns whether it failed.
	 */
	fun recordResourceAttempt(resourceKey: String, message: String, limit: Int): Boolean = synchronized(lock) {
		transaction {
			val owner = resourceOwnerLocked(resourceKey) ?: return@transaction false
			execute(
				"UPDATE photo_resources SET attempts = attempts + 1, lastError = ?, " +
					"state = CASE WHEN attempts + 1 >= ? THEN ? ELSE ? END WHERE resourceKey = ? AND state != ?",
				message, limit.toLong(), RESOURCE_FAILED, RESOURCE_PENDING, resourceKey, RESOURCE_SUCCEEDED,
			)
			refreshAssetOutcomeLocked(owner)
			query("SELECT state FROM photo_resources WHERE resourceKey = ?", resourceKey) {
				it.step()
				it.getLong(0) == RESOURCE_FAILED
			}
		}
	}

	/**
	 * A transport outage says nothing about the asset itself. Return only that resource to
	 * the queue so a later pass tries it again, without counting an attempt.
	 */
	fun recordResourcePending(resourceKey: String) = synchronized(lock) {
		transaction {
			val owner = resourceOwnerLocked(resourceKey) ?: return@transaction
			execute(
				"UPDATE photo_resources SET state = ?, lastError = NULL WHERE resourceKey = ? AND state != ?",
				RESOURCE_PENDING, resourceKey, RESOURCE_SUCCEEDED,
			)
			refreshAssetOutcomeLocked(owner)
		}
	}

	fun markAssetFailed(sourceId: String, localIdentifier: String, revision: Long, message: String) = synchronized(lock) {
		execute(
			"UPDATE photo_assets SET state = ?, lastError = ? WHERE deviceId = ? AND localIdentifier = ? AND revision = ?",
			AssetState.FAILED.raw, message, sourceId, localIdentifier, revision,
		)
	}

	/** The item is still in the library but couldn't be read. Later passes try it again. */
	fun markAssetUnreadable(sourceId: String, localIdentifier: String, revision: Long, message: String) = synchronized(lock) {
		execute(
			"UPDATE photo_assets SET state = ?, lastError = ? WHERE deviceId = ? AND localIdentifier = ? AND revision = ? AND state IN (?, ?, ?)",
			AssetState.UNREADABLE.raw, message, sourceId, localIdentifier, revision,
			AssetState.PENDING.raw, AssetState.PREPARED.raw, AssetState.UNREADABLE.raw,
		)
	}

	/** Only for an item MediaStore no longer lists, or lists as trashed or pending. */
	fun markDeleted(sourceId: String, localIdentifier: String) = synchronized(lock) { markDeletedLocked(sourceId, localIdentifier) }

	/**
	 * Failed assets are never retried in a background loop. An explicit retry returns only
	 * the failed resources to the queue and keeps any successful siblings.
	 */
	fun requeueFailedAssets(sourceId: String, includePhotos: Boolean, includeVideos: Boolean) {
		val mediaTypes = mediaTypes(includePhotos, includeVideos)
		if (mediaTypes.isEmpty()) return
		synchronized(lock) {
			transaction {
				execute(
					"""
					UPDATE photo_resources SET state = ?, attempts = 0, lastError = NULL
					WHERE state = ? AND EXISTS (
						SELECT 1 FROM photo_assets
						WHERE photo_assets.deviceId = photo_resources.deviceId
							AND photo_assets.localIdentifier = photo_resources.localIdentifier
							AND photo_assets.revision = photo_resources.revision
							AND photo_assets.deviceId = ?
							AND photo_assets.state = ?
							AND photo_assets.mediaType IN (${placeholders(mediaTypes.size)})
					)
					""".trimIndent(),
					RESOURCE_PENDING, RESOURCE_FAILED, sourceId, AssetState.FAILED.raw, *mediaTypes.toTypedArray(),
				)
				execute(
					"UPDATE photo_assets SET state = ?, lastError = NULL WHERE deviceId = ? AND state = ? AND mediaType IN (${placeholders(mediaTypes.size)})",
					AssetState.PENDING.raw, sourceId, AssetState.FAILED.raw, *mediaTypes.toTypedArray(),
				)
			}
		}
	}

	// ── Reads for presentation ──

	/**
	 * Queued, prepared, failed and unreadable counts cover only enabled media in folders that
	 * aren't skipped. Uploaded counts and bytes always cover everything so turning a type or a
	 * folder off never hides completed backups; the uploaded counts in skipped folders are
	 * reported separately. A prepared asset counts as queued work only while one of its
	 * resources is still pending, the same rule [nextAssets] selects by.
	 */
	fun statistics(
		sourceId: String,
		includePhotos: Boolean = true,
		includeVideos: Boolean = true,
		skippedFolders: Set<String> = emptySet(),
	): PhotoBackupStatistics = synchronized(lock) {
		val mediaTypes = mediaTypes(includePhotos, includeVideos)
		val mediaPredicate = if (mediaTypes.isEmpty()) "0" else "asset.mediaType IN (${placeholders(mediaTypes.size)}) AND ${backedUpFolder("asset", skippedFolders)}"
		val skippedPredicate = if (skippedFolders.isEmpty()) "0" else "NOT ${backedUpFolder("asset", skippedFolders)}"
		val workArguments: List<Any> = if (mediaTypes.isEmpty()) emptyList() else mediaTypes + skippedFolders
		val arguments = buildList<Any> {
			add(AssetState.PENDING.raw)
			addAll(workArguments)
			add(AssetState.PREPARED.raw)
			addAll(workArguments)
			add(RESOURCE_PENDING)
			add(AssetState.UPLOADED.raw)
			add(AssetState.UPLOADED.raw)
			add(AssetState.FAILED.raw)
			addAll(workArguments)
			add(AssetState.UNREADABLE.raw)
			addAll(workArguments)
			add(AssetState.UPLOADED.raw)
			add(AssetState.UPLOADED.raw)
			add(AssetState.UPLOADED.raw)
			addAll(skippedFolders)
			add(AssetState.UPLOADED.raw)
			addAll(skippedFolders)
			add(sourceId)
		}
		query(
			"""
			SELECT
				SUM(CASE WHEN asset.state = ? AND $mediaPredicate THEN 1 ELSE 0 END),
				SUM(CASE WHEN asset.state = ? AND $mediaPredicate AND EXISTS (
					SELECT 1 FROM photo_resources AS resource
					WHERE resource.deviceId = asset.deviceId
						AND resource.localIdentifier = asset.localIdentifier
						AND resource.revision = asset.revision
						AND resource.state = ?
				) THEN 1 ELSE 0 END),
				SUM(CASE WHEN asset.state = ? AND asset.mediaType = $MEDIA_TYPE_IMAGE THEN 1 ELSE 0 END),
				SUM(CASE WHEN asset.state = ? AND asset.mediaType = $MEDIA_TYPE_VIDEO THEN 1 ELSE 0 END),
				SUM(CASE WHEN asset.state = ? AND $mediaPredicate THEN 1 ELSE 0 END),
				SUM(CASE WHEN asset.state = ? AND $mediaPredicate THEN 1 ELSE 0 END),
				CAST(MIN(TOTAL(CASE WHEN asset.state = ? THEN asset.uploadedBytes ELSE 0 END), 9223372036854775807) AS INTEGER),
				MAX(CASE WHEN asset.state = ? THEN asset.uploadedAt END),
				SUM(CASE WHEN asset.state = ? AND asset.mediaType = $MEDIA_TYPE_IMAGE AND $skippedPredicate THEN 1 ELSE 0 END),
				SUM(CASE WHEN asset.state = ? AND asset.mediaType = $MEDIA_TYPE_VIDEO AND $skippedPredicate THEN 1 ELSE 0 END)
			FROM photo_assets AS asset WHERE asset.deviceId = ?
			""".trimIndent(),
			*arguments.toTypedArray(),
		) { statement ->
			if (!statement.step()) throw DatabaseException("Photo backup statistics returned no row")
			PhotoBackupStatistics(
				queuedCount = statement.getLong(0),
				preparedCount = statement.getLong(1),
				uploadedPhotoCount = statement.getLong(2),
				uploadedVideoCount = statement.getLong(3),
				failedCount = statement.getLong(4),
				uploadedBytes = statement.getLong(6),
				unreadableCount = statement.getLong(5),
				lastUploadedAtMs = if (statement.isNull(7)) null else (statement.getDouble(7) * 1000).toLong(),
				uploadedSkippedPhotoCount = statement.getLong(8),
				uploadedSkippedVideoCount = statement.getLong(9),
			)
		}
	}

	/** Indexed lookup for one visible thumbnail; deleted assets have no record. */
	fun assetRecord(sourceId: String, localIdentifier: String): AssetRecord? = synchronized(lock) {
		query(
			"SELECT state, uploadedBytes FROM photo_assets WHERE deviceId = ? AND localIdentifier = ? AND state != ?",
			sourceId, localIdentifier, AssetState.DELETED.raw,
		) { statement ->
			if (!statement.step()) return@query null
			AssetRecord(assetState(statement.getLong(0)), statement.getLong(1))
		}
	}

	override fun close() = synchronized(lock) { connection.close() }

	// ── Locked helpers ──

	private class AssetRow(val revision: Long, val state: Long, val contentSize: Long, val folder: String?, val creationDate: Double)

	private class ResourceOwner(val sourceId: String, val localIdentifier: String, val revision: Long)

	private fun seedCandidateLocked(candidate: AssetCandidate, sourceId: String, inventoryGeneration: Long?) {
		val existing = assetRowLocked(sourceId, candidate.localIdentifier)
		if (existing != null) {
			// A camera that rewrites a photo in place without touching DATE_MODIFIED still
			// changes its size, and a timestamp-only touch doesn't, so the size decides
			// whether this is new content. The generation only says that the row changed.
			if (candidate.size != existing.contentSize) {
				execute(
					"UPDATE photo_assets SET mediaType = ?, revision = ?, state = ?, creationDate = ?, contentSize = ?, contentGeneration = ?, " +
						"expectedResources = 0, uploadedBytes = 0, uploadedAt = NULL, lastError = NULL WHERE deviceId = ? AND localIdentifier = ?",
					candidate.mediaType, existing.revision + 1, AssetState.PENDING.raw, seconds(candidate.creationDateMs),
					candidate.size, candidate.generation, sourceId, candidate.localIdentifier,
				)
			} else if (existing.state == AssetState.DELETED.raw) {
				reclaimLocked(ResourceOwner(sourceId, candidate.localIdentifier, existing.revision))
			}
			// Moving an item to another folder, or a date Android reads differently, changes its
			// row but not its content.
			if (candidate.folder != existing.folder) {
				execute("UPDATE photo_assets SET folder = ? WHERE deviceId = ? AND localIdentifier = ?", candidate.folder, sourceId, candidate.localIdentifier)
			}
			if (seconds(candidate.creationDateMs) != existing.creationDate) {
				execute("UPDATE photo_assets SET creationDate = ? WHERE deviceId = ? AND localIdentifier = ?", seconds(candidate.creationDateMs), sourceId, candidate.localIdentifier)
			}
			if (inventoryGeneration != null) {
				execute(
					"UPDATE photo_assets SET inventoryGeneration = ? WHERE deviceId = ? AND localIdentifier = ?",
					inventoryGeneration, sourceId, candidate.localIdentifier,
				)
			}
			return
		}
		execute(
			"INSERT INTO photo_assets (deviceId, localIdentifier, mediaType, revision, state, creationDate, contentSize, " +
				"contentGeneration, inventoryGeneration, folder) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
			sourceId, candidate.localIdentifier, candidate.mediaType, AssetState.PENDING.raw, seconds(candidate.creationDateMs),
			candidate.size, candidate.generation, inventoryGeneration ?: 0L, candidate.folder,
		)
	}

	/**
	 * An item back from the trash, from a remounted card, or visible again after access returned
	 * has the same content, so it keeps its revision and with it the resources and receipts
	 * that revision already has. Its state is rebuilt from them: a backed-up item is backed up
	 * again at once, an interrupted upload resumes, and a rejected item stays rejected.
	 */
	private fun reclaimLocked(owner: ResourceOwner) {
		val hasResources = query(
			"SELECT EXISTS (SELECT 1 FROM photo_resources WHERE deviceId = ? AND localIdentifier = ? AND revision = ?)",
			owner.sourceId, owner.localIdentifier, owner.revision,
		) {
			it.step()
			it.getLong(0) != 0L
		}
		execute(
			"UPDATE photo_assets SET state = ?, lastError = NULL WHERE deviceId = ? AND localIdentifier = ?",
			if (hasResources) AssetState.PREPARED.raw else AssetState.PENDING.raw, owner.sourceId, owner.localIdentifier,
		)
		refreshAssetOutcomeLocked(owner)
	}

	private fun markDeletedLocked(sourceId: String, localIdentifier: String) = execute(
		"UPDATE photo_assets SET state = ?, lastError = NULL WHERE deviceId = ? AND localIdentifier = ?",
		AssetState.DELETED.raw, sourceId, localIdentifier,
	)

	private fun assetRowLocked(sourceId: String, localIdentifier: String): AssetRow? =
		query("SELECT revision, state, contentSize, folder, creationDate FROM photo_assets WHERE deviceId = ? AND localIdentifier = ?", sourceId, localIdentifier) {
			if (it.step()) AssetRow(it.getLong(0), it.getLong(1), it.getLong(2), if (it.isNull(3)) null else it.getText(3), it.getDouble(4)) else null
		}

	private fun resourceOwnerLocked(resourceKey: String): ResourceOwner? =
		query("SELECT deviceId, localIdentifier, revision FROM photo_resources WHERE resourceKey = ?", resourceKey) {
			if (it.step()) ResourceOwner(it.getText(0), it.getText(1), it.getLong(2)) else null
		}

	private fun recordResourceSucceededLocked(resourceKey: String, bytes: Long) {
		val owner = resourceOwnerLocked(resourceKey) ?: return
		execute("UPDATE photo_resources SET state = ?, bytes = ?, lastError = NULL WHERE resourceKey = ?", RESOURCE_SUCCEEDED, bytes, resourceKey)
		refreshAssetOutcomeLocked(owner)
	}

	/**
	 * Finalizes an asset only from the resources of its current revision: a receipt for an
	 * earlier rendition can't mark an edited photo backed up, or revive a deleted one.
	 */
	private fun refreshAssetOutcomeLocked(owner: ResourceOwner) {
		val asset = assetRowLocked(owner.sourceId, owner.localIdentifier) ?: return
		if (asset.revision != owner.revision || asset.state == AssetState.DELETED.raw) return
		class Outcome(val total: Long, val succeeded: Long, val failed: Long, val bytes: Long, val message: String?)
		val outcome = query(
			"SELECT COUNT(*), SUM(CASE WHEN state = ? THEN 1 ELSE 0 END), SUM(CASE WHEN state = ? THEN 1 ELSE 0 END), " +
				"CAST(MIN(TOTAL(CASE WHEN state = ? THEN bytes ELSE 0 END), 9223372036854775807) AS INTEGER), " +
				"MAX(CASE WHEN state = ? THEN lastError ELSE NULL END) FROM photo_resources WHERE deviceId = ? AND localIdentifier = ? AND revision = ?",
			RESOURCE_SUCCEEDED, RESOURCE_FAILED, RESOURCE_SUCCEEDED, RESOURCE_FAILED, owner.sourceId, owner.localIdentifier, owner.revision,
		) {
			if (!it.step()) throw DatabaseException("Photo backup resource outcome returned no row")
			Outcome(it.getLong(0), it.getLong(1), it.getLong(2), it.getLong(3), if (it.isNull(4)) null else it.getText(4))
		}
		when {
			outcome.total > 0 && outcome.succeeded == outcome.total -> execute(
				"UPDATE photo_assets SET state = ?, uploadedBytes = ?, uploadedAt = ?, lastError = NULL WHERE deviceId = ? AND localIdentifier = ? AND revision = ?",
				AssetState.UPLOADED.raw, outcome.bytes, System.currentTimeMillis() / 1000.0, owner.sourceId, owner.localIdentifier, owner.revision,
			)
			outcome.failed > 0 -> execute(
				"UPDATE photo_assets SET state = ?, lastError = ? WHERE deviceId = ? AND localIdentifier = ? AND revision = ?",
				AssetState.FAILED.raw, outcome.message ?: "The upload failed", owner.sourceId, owner.localIdentifier, owner.revision,
			)
		}
	}

	private fun inventoryScanLocked(sourceId: String): InventoryScan? =
		query("SELECT generation, changeToken, imageCursor, videoCursor FROM photo_inventory_scans WHERE deviceId = ?", sourceId) {
			if (!it.step()) return@query null
			InventoryScan(
				it.getLong(0),
				String(it.getBlob(1), Charsets.UTF_8),
				if (it.isNull(2)) null else it.getLong(2),
				if (it.isNull(3)) null else it.getLong(3),
			)
		}

	private fun nextInventoryGenerationLocked(sourceId: String): Long =
		query("SELECT COALESCE(MAX(inventoryGeneration), 0) + 1 FROM photo_assets WHERE deviceId = ?", sourceId) {
			it.step()
			it.getLong(0)
		}

	private fun setMetadataLocked(value: String, key: String, sourceId: String) =
		execute("INSERT OR REPLACE INTO photo_metadata (deviceId, key, value) VALUES (?, ?, ?)", sourceId, key, value.toByteArray())

	// ── Statement plumbing ──

	private inline fun <T> transaction(block: () -> T): T {
		connection.execSQL("BEGIN IMMEDIATE")
		try {
			val result = block()
			connection.execSQL("COMMIT")
			return result
		} catch (error: Throwable) {
			runCatching { connection.execSQL("ROLLBACK") }
			throw error
		}
	}

	private inline fun <T> query(sql: String, vararg arguments: Any, read: (SQLiteStatement) -> T): T =
		connection.prepare(sql).use { statement ->
			bind(statement, arguments)
			read(statement)
		}

	private fun execute(sql: String, vararg arguments: Any) {
		connection.prepare(sql).use { statement ->
			bind(statement, arguments)
			statement.step()
		}
	}

	private fun bind(statement: SQLiteStatement, arguments: Array<out Any>) {
		arguments.forEachIndexed { offset, value ->
			val index = offset + 1
			when (value) {
				is String -> statement.bindText(index, value)
				is Long -> statement.bindLong(index, value)
				is Double -> statement.bindDouble(index, value)
				is ByteArray -> statement.bindBlob(index, value)
				else -> throw IllegalArgumentException("Unsupported SQLite argument ${value::class}")
			}
		}
	}

	private fun changes(): Long = query("SELECT changes()") {
		it.step()
		it.getLong(0)
	}

	private fun integer(sql: String): Long = query(sql) {
		if (!it.step()) throw DatabaseException("Database returned no value for $sql")
		it.getLong(0)
	}

	private fun text(sql: String): String = query(sql) {
		if (!it.step()) throw DatabaseException("Database returned no value for $sql")
		it.getText(0)
	}

	companion object {
		const val SCHEMA_VERSION = 6L
		const val MEDIA_TYPE_IMAGE = 1L
		const val MEDIA_TYPE_VIDEO = 2L
		const val RESOURCE_PENDING = 0L
		const val RESOURCE_SUCCEEDED = 2L
		const val RESOURCE_FAILED = 3L

		/** An inventory cursor below every MediaStore id: the media type is fully read. */
		const val INVENTORY_FINISHED = 0L

		/** No resource a phone produces can plausibly approach one tebibyte. */
		const val MAX_RESOURCE_BYTES = 1L shl 40
		private const val CHANGE_TOKEN_KEY = "photoLibraryChangeToken"

		fun isValidResourceByteCount(bytes: Long): Boolean = bytes in 1..MAX_RESOURCE_BYTES

		private fun mediaTypes(includePhotos: Boolean, includeVideos: Boolean): List<Long> = buildList {
			if (includePhotos) add(MEDIA_TYPE_IMAGE)
			if (includeVideos) add(MEDIA_TYPE_VIDEO)
		}

		private fun placeholders(count: Int) = List(count) { "?" }.joinToString(",")

		/**
		 * A condition on [table]'s folder that holds outside [skippedFolders]; bind the skipped
		 * folders where it appears. An unknown folder (NULL, before an inventory recorded it)
		 * is never skipped.
		 */
		private fun backedUpFolder(table: String, skippedFolders: Set<String>): String =
			if (skippedFolders.isEmpty()) "1" else "($table.folder IS NULL OR $table.folder NOT IN (${placeholders(skippedFolders.size)}))"

		private fun seconds(milliseconds: Long): Double = milliseconds / 1000.0

		private fun millis(seconds: Double): Long = Math.round(seconds * 1000)

		private fun assetState(raw: Long): AssetState =
			AssetState.entries.firstOrNull { it.raw == raw } ?: throw DatabaseException("Photo backup asset has an invalid state")
	}
}

package com.umbrel.kit.backup

import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException

/** An in-memory MediaStore with generations, trash, permanent deletion, and partial access. */
internal class FakeLibrary : PhotoBackupLibrary {
	class Item(
		val id: Long,
		val mediaType: Long,
		val createdMs: Long,
		var generationModified: Long,
		var bytes: ByteArray,
		var trashed: Boolean = false,
		/** Listed by MediaStore, but opening it fails, as on a card I/O error. */
		var unreadable: Boolean = false,
		/** Removed after the inventory read it, so a lookup by id finds no row. */
		var gone: Boolean = false,
		var folder: String = CAMERA_FOLDER,
	) {
		val localIdentifier get() = identifier(id, mediaType)
		val candidate get() = PhotoBackupLedger.AssetCandidate(localIdentifier, mediaType, createdMs, bytes.size.toLong(), generationModified, folder)
	}

	override var access = PhotoLibraryAccess.FULL
	override var canReadLocation = true

	/** MediaStore refuses the original although the permission is granted, as some systems do. */
	var refusesOriginals = false
	var version = "v1"
	private var generation = 0L
	private var nextId = 1L
	val items = LinkedHashMap<String, Item>()

	/** Under SELECTED access, the items the user picked. Picking more adds grants, not row changes. */
	private val selection = HashSet<String>()

	/** The `before` argument of every inventory page read. */
	val pageRequests = mutableListOf<Long?>()

	fun add(
		mediaType: Long = PhotoBackupLedger.MEDIA_TYPE_IMAGE,
		createdMs: Long = 1_000L * nextId,
		bytes: ByteArray = ByteArray(16) { 1 },
		folder: String = CAMERA_FOLDER,
	): String {
		val item = Item(nextId++, mediaType, createdMs, ++generation, bytes, folder = folder)
		items[item.localIdentifier] = item
		return item.localIdentifier
	}

	/** Moves the file to another folder, which changes its row but not its content. */
	fun move(localIdentifier: String, folder: String) {
		items.getValue(localIdentifier).apply {
			this.folder = folder
			generationModified = ++generation
		}
	}

	/** Rewrites the file in place, as an editor or a camera's final processing does. */
	fun edit(localIdentifier: String, bytes: ByteArray) {
		items.getValue(localIdentifier).apply {
			this.bytes = bytes
			generationModified = ++generation
		}
	}

	/** A metadata-only update, such as a new modification date or a favorite. */
	fun touch(localIdentifier: String) {
		items.getValue(localIdentifier).generationModified = ++generation
	}

	fun trash(localIdentifier: String) {
		items.getValue(localIdentifier).apply {
			trashed = true
			generationModified = ++generation
		}
	}

	fun untrash(localIdentifier: String) {
		items.getValue(localIdentifier).apply {
			trashed = false
			generationModified = ++generation
		}
	}

	/** MediaProvider records a grant in its own write transaction, which advances the generation. */
	fun select(localIdentifier: String) {
		selection += localIdentifier
		generation++
	}

	/** A permanent deletion leaves no row, so no incremental query can see it. */
	fun delete(localIdentifier: String) {
		items.remove(localIdentifier)
		generation++
	}

	private fun accessible(item: Item) = when (access) {
		PhotoLibraryAccess.NONE -> false
		PhotoLibraryAccess.SELECTED -> item.localIdentifier in selection
		PhotoLibraryAccess.FULL -> true
	}

	private fun visible(mediaType: Long) = items.values.filter { it.mediaType == mediaType && !it.trashed && accessible(it) }

	override fun changeToken() =
		LibraryChangeToken(mapOf("external_primary" to LibraryChangeToken.Volume(version, generation)), access, setOf(access.name))

	override fun assets(mediaType: Long, before: Long?, limit: Int): InventoryPage {
		pageRequests += before
		val page = visible(mediaType).filter { before == null || it.id < before }.sortedByDescending { it.id }.take(limit)
		return InventoryPage(page.map { it.candidate }, page.lastOrNull()?.id?.takeIf { page.size == limit })
	}

	override fun <T> changes(volume: String, mediaType: Long, generation: Long, block: (Sequence<LibraryChange>) -> T): T = block(
		items.values.filter { it.mediaType == mediaType && it.generationModified > generation && accessible(it) }.asSequence().map {
			if (it.trashed) LibraryChange.Removal(it.localIdentifier) else LibraryChange.Upsert(it.candidate)
		},
	)

	override fun count(mediaType: Long): Long = visible(mediaType).size.toLong()

	override fun resource(localIdentifier: String): ResourceLookup {
		val item = items[localIdentifier]?.takeIf { !it.trashed && !it.gone } ?: return ResourceLookup.Removed
		return ResourceLookup.Found(
			LibraryResource(
				displayName = if (item.mediaType == PhotoBackupLedger.MEDIA_TYPE_VIDEO) "VID_${item.id}.mp4" else "IMG_${item.id}.jpg",
				mimeType = if (item.mediaType == PhotoBackupLedger.MEDIA_TYPE_VIDEO) "video/mp4" else "image/jpeg",
				takenAtMs = item.createdMs,
			),
		)
	}

	override fun open(localIdentifier: String): OpenedResource {
		if (!canReadLocation || refusesOriginals) throw LocationAccessRequiredException()
		val item = items[localIdentifier]?.takeIf { !it.trashed && !it.gone && !it.unreadable } ?: throw FileNotFoundException(localIdentifier)
		return OpenedResource(item.bytes.size.toLong(), ByteArrayInputStream(item.bytes))
	}

	companion object {
		fun identifier(id: Long, mediaType: Long) =
			if (mediaType == PhotoBackupLedger.MEDIA_TYPE_VIDEO) "content://media/external/video/media/$id" else "content://media/external/images/media/$id"
	}
}

internal class FakeServer : PhotoBackupServer {
	var reachable = true

	/** Set to make every address answer with another identity. */
	var refusal: String? = null
	var host = "192.168.1.10"
	val resolutions = mutableListOf<Umbreld.Target>()
	val endpoints = mutableListOf<String>()
	var grantError: Exception? = null
	val uploads = mutableListOf<PhotoUpload>()
	val uploadedLengths = mutableListOf<Long>()
	var respond: (PhotoUpload) -> PhotoUploadResult = { PhotoUploadResult.Succeeded(10) }
	var grantSource: (String) -> Umbreld.PhotoBackupSource = { Umbreld.PhotoBackupSource(it, "0", "Android phone") }
	var grantToken = "grant-1"
	val grantsCreated = mutableListOf<String>()

	/** The name each new grant suggested for its source. */
	val suggestedNames = mutableListOf<String>()
	var revocations = 0
	var receipts: List<Umbreld.PhotoBackupResourceReceipt> = emptyList()

	/** The account's Photos sources; the Umbrel's own library alone by default. */
	var sources = listOf(Umbreld.PhotoSourceSummary("umbrel", "Umbrel", Umbreld.PhotoSourceSummary.Stats(120, 4)))
	var sourcesError: Exception? = null
	var sourceReads = 0

	/** The Umbrel and account each read of the sources went to. */
	val sourceRequests = mutableListOf<Pair<String, String>>()

	/** Runs while a read of the sources is in flight, as a change made meanwhile would. */
	var whileReadingSources: () -> Unit = {}

	/** The Umbrel each revoked grant belonged to. */
	val revokedDevices = mutableListOf<String>()

	override suspend fun resolveEndpoint(target: Umbreld.Target): EndpointResolution {
		resolutions += target
		refusal?.let { return EndpointResolution.Refused(it) }
		return if (reachable) EndpointResolution.Resolved(UploadEndpoint(target, host)) else EndpointResolution.Unreachable
	}

	override suspend fun upload(endpoint: UploadEndpoint, grant: String, upload: PhotoUpload, source: UploadSource): PhotoUploadResult {
		endpoints += endpoint.host
		uploads += upload
		uploadedLengths += source.length
		return respond(upload)
	}

	override suspend fun createGrant(target: Umbreld.Target, session: Umbreld.Session, sourceId: String, suggestedName: String): Umbreld.PhotoBackupGrant {
		grantError?.let { throw it }
		grantsCreated += sourceId
		suggestedNames += suggestedName
		return Umbreld.PhotoBackupGrant(grantToken, grantSource(sourceId))
	}

	override suspend fun revokeGrant(target: Umbreld.Target, session: Umbreld.Session) {
		revocations++
		revokedDevices += target.deviceId
	}

	override suspend fun photoSources(target: Umbreld.Target, session: Umbreld.Session): List<Umbreld.PhotoSourceSummary> {
		sourceReads++
		sourceRequests += target.deviceId to session.accountId
		whileReadingSources()
		sourcesError?.let { throw it }
		return sources
	}

	override suspend fun confirmedResources(
		target: Umbreld.Target,
		session: Umbreld.Session,
		sourceId: String,
		resources: List<Umbreld.PhotoBackupResourceQuery>,
	) = receipts
}

internal class FakeSecrets : PhotoBackupSecrets {
	val grants = HashMap<String, String>()
	val sourceIds = HashMap<String, String>()
	val sessions = HashMap<String, Umbreld.Session>()
	var grantUnavailable = false
	var sourceIdUnavailable = false

	override fun grant(deviceId: String, accountId: String): SecretStore.TokenReadResult = when {
		grantUnavailable -> SecretStore.TokenReadResult.Unavailable("test")
		else -> grants["$deviceId:$accountId"]?.let { SecretStore.TokenReadResult.Found(it) } ?: SecretStore.TokenReadResult.Missing
	}

	override fun setGrant(token: String, deviceId: String, accountId: String): Boolean {
		grants["$deviceId:$accountId"] = token
		return true
	}

	override fun deleteGrant(deviceId: String, accountId: String) {
		grants.remove("$deviceId:$accountId")
	}

	override fun sourceId(deviceId: String, accountId: String): SecretStore.TokenReadResult = when {
		sourceIdUnavailable -> SecretStore.TokenReadResult.Unavailable("test")
		else -> sourceIds["$deviceId:$accountId"]?.let { SecretStore.TokenReadResult.Found(it) } ?: SecretStore.TokenReadResult.Missing
	}

	override fun setSourceId(sourceId: String, deviceId: String, accountId: String): Boolean {
		sourceIds["$deviceId:$accountId"] = sourceId
		return true
	}

	override fun session(deviceId: String): SecretStore.SessionReadResult =
		sessions[deviceId]?.let { SecretStore.SessionReadResult.Found(it) } ?: SecretStore.SessionReadResult.Missing
}

internal const val CAMERA_FOLDER = "dcim/camera/"
internal const val WHATSAPP_FOLDER = "pictures/whatsapp/"

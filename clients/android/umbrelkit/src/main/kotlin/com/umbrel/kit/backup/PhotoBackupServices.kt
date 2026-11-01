package com.umbrel.kit.backup

import com.umbrel.kit.LocalHttpsTransport
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.coroutines.executeAsync
import okio.BufferedSink
import java.io.EOFException
import java.io.IOException
import java.util.Base64
import java.util.concurrent.TimeUnit

/** Reading the item failed or the item changed: the item's problem, never the network's. */
class PhotoBackupSourceException(message: String, cause: Throwable? = null) : IOException(message, cause)

class PhotoUpload(
	val resourceKey: String,
	val fileExtension: String,
	val filename: String,
	val mimeType: String,
	val creationDateMs: Long?,
)

/**
 * The bytes of one upload. Every send opens the item again, so OkHttp can resend a request
 * on a fresh connection when the pooled one it picked turns out to be closed.
 */
class UploadSource(val length: Long, val open: () -> OpenedResource)

/** An address of the Umbrel that just proved its pinned identity over HTTPS. */
class UploadEndpoint(val target: Umbreld.Target, val host: String)

sealed class EndpointResolution {
	data class Resolved(val endpoint: UploadEndpoint) : EndpointResolution()

	/** No address answered: the Umbrel is off, or this phone can't reach it on the network or through Tailscale. */
	data object Unreachable : EndpointResolution()

	/** An address answered with another identity, or the pinned CA couldn't be read. */
	data class Refused(val message: String) : EndpointResolution()
}

sealed class PhotoUploadResult {
	data class Succeeded(val bytes: Long) : PhotoUploadResult()

	/** Umbrel answered, but not with a usable receipt. */
	data class Rejected(val status: Int, val issue: PhotoBackupIssue?) : PhotoUploadResult()

	/**
	 * [afterBody] is true when the whole file had been sent: the Umbrel received it and its
	 * answer was lost or slow, which says nothing about the route to it.
	 */
	data class TransportFailed(val error: IOException, val afterBody: Boolean = false) : PhotoUploadResult()
}

/** The Umbrel calls backup makes; a seam so JVM tests can stand in for the server. */
interface PhotoBackupServer {
	/** The address uploads go to: whichever one the kit's endpoint resolver verifies. */
	suspend fun resolveEndpoint(target: Umbreld.Target): EndpointResolution

	suspend fun upload(endpoint: UploadEndpoint, grant: String, upload: PhotoUpload, source: UploadSource): PhotoUploadResult

	suspend fun createGrant(target: Umbreld.Target, session: Umbreld.Session, sourceId: String, suggestedName: String): Umbreld.PhotoBackupGrant

	suspend fun revokeGrant(target: Umbreld.Target, session: Umbreld.Session)

	/** The account's Photos sources, read before a new source would store the account's phone backups again. */
	suspend fun photoSources(target: Umbreld.Target, session: Umbreld.Session): List<Umbreld.PhotoSourceSummary>

	suspend fun confirmedResources(
		target: Umbreld.Target,
		session: Umbreld.Session,
		sourceId: String,
		resources: List<Umbreld.PhotoBackupResourceQuery>,
	): List<Umbreld.PhotoBackupResourceReceipt>
}

/** The Keystore-sealed values backup reads and writes; a seam for JVM tests. */
interface PhotoBackupSecrets {
	fun grant(deviceId: String, accountId: String): SecretStore.TokenReadResult

	fun setGrant(token: String, deviceId: String, accountId: String): Boolean

	fun deleteGrant(deviceId: String, accountId: String)

	fun sourceId(deviceId: String, accountId: String): SecretStore.TokenReadResult

	fun setSourceId(sourceId: String, deviceId: String, accountId: String): Boolean

	fun session(deviceId: String): SecretStore.SessionReadResult
}

object SecretStorePhotoBackupSecrets : PhotoBackupSecrets {
	override fun grant(deviceId: String, accountId: String) = SecretStore.readPhotoBackupGrant(deviceId, accountId)

	override fun setGrant(token: String, deviceId: String, accountId: String) = SecretStore.setPhotoBackupGrant(token, deviceId, accountId)

	override fun deleteGrant(deviceId: String, accountId: String) = SecretStore.deletePhotoBackupGrant(deviceId, accountId)

	override fun sourceId(deviceId: String, accountId: String) = SecretStore.readPhotoBackupSourceId(deviceId, accountId)

	override fun setSourceId(sourceId: String, deviceId: String, accountId: String) =
		SecretStore.setPhotoBackupSourceId(sourceId, deviceId, accountId)

	override fun session(deviceId: String) = SecretStore.readSession(deviceId)
}

/**
 * Uploads use the same pinned HTTPS as every other request to the Umbrel, sent to whichever
 * of its addresses the kit's endpoint resolver verifies, on the local network or through
 * Tailscale. iOS differs because PhotoKit's background uploader sends a stored request with
 * no hook to evaluate trust, so iOS uploads plain HTTP to a Tailscale address only. Android
 * uploads in-process, so the CA pinned at pairing applies to every upload.
 */
class UmbrelPhotoBackupServer internal constructor(
	private val clientFor: suspend (deviceId: String, host: String) -> OkHttpClient,
	private val forgetRoute: (Umbreld.Target) -> Unit,
) : PhotoBackupServer {
	constructor() : this(
		clientFor = { deviceId, host -> uploadClient(LocalHttpsTransport.pinnedClient(deviceId, host)) },
		forgetRoute = Umbreld::invalidateResolvedHost,
	)

	override suspend fun resolveEndpoint(target: Umbreld.Target): EndpointResolution = try {
		EndpointResolution.Resolved(UploadEndpoint(target, Umbreld.resolvedHost(target)))
	} catch (cancelled: CancellationException) {
		throw cancelled
	} catch (error: Umbreld.Error) {
		if (error.isConnectivityFailure) EndpointResolution.Unreachable else EndpointResolution.Refused(error.message ?: "Couldn’t verify this Umbrel")
	}

	override suspend fun createGrant(target: Umbreld.Target, session: Umbreld.Session, sourceId: String, suggestedName: String) =
		Umbreld.createPhotoBackupGrant(target, session, sourceId, suggestedName)

	override suspend fun revokeGrant(target: Umbreld.Target, session: Umbreld.Session) = Umbreld.revokePhotoBackupGrant(target, session)

	override suspend fun photoSources(target: Umbreld.Target, session: Umbreld.Session) = Umbreld.photoSources(target, session)

	override suspend fun confirmedResources(
		target: Umbreld.Target,
		session: Umbreld.Session,
		sourceId: String,
		resources: List<Umbreld.PhotoBackupResourceQuery>,
	) = Umbreld.confirmedPhotoBackupResources(target, session, sourceId, resources)

	/**
	 * POST /api/photos/upload with the raw bytes as the body. Headers carry the resource
	 * identity and the original filename (Base64, because header values are ASCII); the
	 * capture date is only a fallback for files whose bytes contain no date.
	 */
	override suspend fun upload(endpoint: UploadEndpoint, grant: String, upload: PhotoUpload, source: UploadSource): PhotoUploadResult {
		val body = SourceBody(upload.mimeType, source)
		val builder = Request.Builder()
			.url(Umbreld.httpsUrl(endpoint.host, "/api/photos/upload"))
			.header("Authorization", "Bearer $grant")
			.header("X-Umbrel-Photo-Backup-Key", upload.resourceKey)
			.header("X-Umbrel-Photo-Backup-Extension", upload.fileExtension)
			.header("X-Umbrel-Photo-Original-Filename-Base64", Base64.getEncoder().encodeToString(upload.filename.toByteArray(Charsets.UTF_8)))
			.post(body)
		upload.creationDateMs?.let { ms ->
			if (ms in MIN_CREATION_DATE_MS..MAX_CREATION_DATE_MS) builder.header("X-Umbrel-Photo-Creation-Date-Ms", ms.toString())
		}
		return try {
			clientFor(endpoint.target.deviceId, endpoint.host).newCall(builder.build()).executeAsync().use { response ->
				val issue = PhotoBackupIssue.fromErrorHeader(response.header(PhotoBackupIssue.ERROR_HEADER))
				when {
					response.code == 401 -> PhotoUploadResult.Rejected(response.code, PhotoBackupIssue.AUTHENTICATION_REQUIRED)
					response.code == 507 || issue != null -> PhotoUploadResult.Rejected(response.code, PhotoBackupIssue.INSUFFICIENT_STORAGE)
					response.isSuccessful -> {
						val bytes = response.header("X-Umbrel-Upload-Bytes")?.toLongOrNull()
						if (response.header("X-Umbrel-Photo-Backup-Key") == upload.resourceKey && bytes != null && PhotoBackupLedger.isValidResourceByteCount(bytes)) {
							PhotoUploadResult.Succeeded(bytes)
						} else {
							PhotoUploadResult.Rejected(response.code, null)
						}
					}
					else -> PhotoUploadResult.Rejected(response.code, null)
				}
			}
		} catch (error: PhotoBackupSourceException) {
			throw error
		} catch (error: IOException) {
			// The next pass verifies the addresses again instead of reusing one that failed.
			if (PhotoBackupTransportFailure.isConnectivityFailure(error) || PhotoBackupTransportFailure.isTrustFailure(error)) forgetRoute(endpoint.target)
			PhotoUploadResult.TransportFailed(error, afterBody = body.sent)
		}
	}

	/**
	 * Streams exactly the length taken from the open descriptor, as a Content-Length body:
	 * umbreld requires a positive Content-Length and never sees chunked encoding. A file that
	 * shrinks or grows mid-upload aborts the request before its final byte rather than
	 * sending a body that disagrees with its length. Each write opens the item again, so the
	 * body is not one-shot and OkHttp may resend it.
	 */
	private class SourceBody(private val mimeType: String, private val source: UploadSource) : RequestBody() {
		/** Whether the last write sent every byte. */
		@Volatile
		var sent = false
			private set

		override fun contentType() = mimeType.toMediaTypeOrNull() ?: "application/octet-stream".toMediaTypeOrNull()

		override fun contentLength() = source.length

		override fun writeTo(sink: BufferedSink) {
			sent = false
			val opened = readSource { source.open() }
			opened.use {
				if (it.length != source.length) throw PhotoBackupSourceException("The item changed while uploading")
				val buffer = ByteArray(BUFFER_BYTES)
				var remaining = source.length
				while (remaining > 0) {
					val read = readSource { it.stream.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt()) }
					if (read < 0) throw PhotoBackupSourceException("The item changed while uploading", EOFException())
					remaining -= read
					if (remaining == 0L && readSource { it.stream.read() } != -1) throw PhotoBackupSourceException("The item changed while uploading")
					sink.write(buffer, 0, read)
				}
			}
			sink.flush()
			sent = true
		}

		private inline fun <T> readSource(read: () -> T): T = try {
			read()
		} catch (error: PhotoBackupSourceException) {
			throw error
		} catch (error: IOException) {
			throw PhotoBackupSourceException("Couldn’t read the item", error)
		} catch (error: SecurityException) {
			throw PhotoBackupSourceException("Couldn’t read the item", error)
		}
	}

	companion object {
		private const val BUFFER_BYTES = 64 * 1024
		private const val MIN_CREATION_DATE_MS = -62_135_596_800_000L
		private const val MAX_CREATION_DATE_MS = 253_402_300_799_999L

		/**
		 * The upload policy on top of [base], the pinned client for one address of the Umbrel,
		 * sharing its connection pool and trust. HTTP/1.1 only: HTTP/2 would cap throughput at
		 * the server's flow-control window per round trip, and the engine sends one file at a
		 * time. umbreld closes idle connections after 5 s, and OkHttp reuses a pooled one for
		 * up to 10 s without probing it, so a request can go out on a closed connection. The
		 * body can be written again, and umbreld answers a repeated resource key with the
		 * existing receipt, so OkHttp may resend it on a fresh connection.
		 */
		internal fun uploadClient(base: OkHttpClient): OkHttpClient = base.newBuilder()
			.protocols(listOf(Protocol.HTTP_1_1))
			.retryOnConnectionFailure(true)
			.connectTimeout(15, TimeUnit.SECONDS)
			.readTimeout(120, TimeUnit.SECONDS)
			.writeTimeout(120, TimeUnit.SECONDS)
			.build()
	}
}

package com.umbrel.android.browser

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import androidx.annotation.MainThread
import androidx.core.net.toUri
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.Base64
import java.util.UUID

// Downloads a page makes from data it already holds: data: addresses, decoded here, and blob:
// addresses, whose bytes exist only inside the page and are read out of it.

/**
 * The most a data: or blob: download may hold. WebKit on iOS streams these to disk itself and
 * sets no limit. Here a blob crosses from the page a slice at a time, so memory stays flat
 * whatever the size; the limit bounds how long that runs and how much of the cache one download
 * takes. It covers what web apps build in the page (exports, a photo or video fetched into a
 * blob before saving it); anything larger is better served as an ordinary download, which
 * streams from the server with no limit.
 */
internal const val MAX_PAGE_DOWNLOAD_BYTES = 2L shl 30

// A blob's bytes cross in slices this size, base64 encoded: about 1.4 MB of text per message.
internal const val BLOB_SLICE_BYTES = 1 shl 20
private const val MAX_SLICE_CHARS = (BLOB_SLICE_BYTES + 2) / 3 * 4

// Anything else the page sends is a few fields; a longer message isn't one of them.
private const val MAX_MESSAGE_CHARS = 64 * 1024

// File systems allow 255 bytes in a name.
private const val MAX_NAME_BYTES = 255

private const val RESERVED_NAME_CHARACTERS = "\"*:<>?|"

// Characters that reorder the text around them, which can make "photo.exe" read as something else.
private val BIDI_CONTROLS = setOf('\u200E', '\u200F', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069')

private val MIME_ESSENCE = Regex("""[!#$%&'*+.^_`|~0-9a-z-]+/[!#$%&'*+.^_`|~0-9a-z-]+""")
private val BASE64_MARKER = Regex(""";( *)base64$""", RegexOption.IGNORE_CASE)

/** What a data: address holds. */
internal class DataDownload(val mimeType: String, val bytes: ByteArray)

/**
 * Decodes a data: address as browsers do (the Fetch standard's data: URL processor): the body
 * percent-decoded, then base64-decoded when marked so, with its MIME type, text/plain when it
 * gives none. Null when it isn't well formed or holds more than [limit] bytes.
 */
internal fun decodeDataUrl(url: String, limit: Long = MAX_PAGE_DOWNLOAD_BYTES): DataDownload? {
	if (!url.startsWith("data:", ignoreCase = true)) return null
	// A fragment is no part of the data.
	val address = url.substringBefore('#')
	val comma = address.indexOf(',')
	if (comma < 0) return null
	var header = address.substring(5, comma).trim()
	val marker = BASE64_MARKER.find(header)
	if (marker != null) header = header.substring(0, marker.range.first)
	val body = percentDecoded(address.substring(comma + 1))
	val bytes = if (marker == null) body else {
		// Forgiving base64: whitespace is skipped and the padding is optional.
		var text = String(body, Charsets.ISO_8859_1).filterNot { it in " \t\n\u000C\r" }
		if (text.length % 4 == 0) text = text.removeSuffix("=").removeSuffix("=")
		try {
			Base64.getDecoder().decode(text)
		} catch (error: IllegalArgumentException) {
			return null
		}
	}
	if (bytes.size > limit) return null
	val essence = header.substringBefore(';').trim().lowercase()
	return DataDownload(if (MIME_ESSENCE.matches(essence)) essence else "text/plain", bytes)
}

/** Each %XX is the byte it names; everything else is its own UTF-8 bytes. */
private fun percentDecoded(text: String): ByteArray {
	val input = text.toByteArray(Charsets.UTF_8)
	val output = ByteArrayOutputStream(input.size)
	var index = 0
	while (index < input.size) {
		val byte = input[index]
		if (byte == '%'.code.toByte() && index + 2 < input.size) {
			val high = Character.digit(input[index + 1].toInt(), 16)
			val low = Character.digit(input[index + 2].toInt(), 16)
			if (high >= 0 && low >= 0) {
				output.write(high * 16 + low)
				index += 3
				continue
			}
		}
		output.write(byte.toInt())
		index++
	}
	return output.toByteArray()
}

/**
 * The name a download is saved under. A page that names its link (a blob: or data: link's
 * download attribute) gets that name, with an extension for its type if it has none. Otherwise it is the name a
 * browser picks from the response and address; a data: or blob: address has no name in it, so
 * only its type counts. Either way it is one plain file name.
 */
internal fun downloadName(url: String?, contentDisposition: String?, mimeType: String?, suggested: String? = null): String {
	val type = mimeType?.substringBefore(';')?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
	suggested?.let(::plainFileName)?.let { name ->
		val extension = type?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
		return if ('.' in name || extension == null) name else plainFileName("$name.$extension") ?: name
	}
	val webUrl = url?.takeIf { BrowserPage.isWebAddress(it.toUri()) }.orEmpty()
	return plainFileName(URLUtil.guessFileName(webUrl, contentDisposition, type)) ?: "downloadfile"
}

/**
 * A name as a single plain file name: no folders, nothing other apps' storage refuses or that
 * disguises the name, not hidden, and short enough for any file system, keeping its extension.
 * Null when nothing is left.
 */
internal fun plainFileName(name: String): String? {
	val cleaned = name.substringAfterLast('/').substringAfterLast('\\')
		.filterNot { it.isISOControl() || it in BIDI_CONTROLS }
		.map { if (it in RESERVED_NAME_CHARACTERS) '_' else it }
		.joinToString("")
		.trim()
		.trimStart('.')
		.trimEnd('.', ' ')
	if (cleaned.isEmpty()) return null
	if (cleaned.toByteArray().size <= MAX_NAME_BYTES) return cleaned
	val dot = cleaned.lastIndexOf('.')
	val extension = if (dot > 0 && cleaned.length - dot <= 16) cleaned.substring(dot) else ""
	var base = cleaned.substring(0, cleaned.length - extension.length).take(MAX_NAME_BYTES)
	while (base.isNotEmpty() && (base.last().isHighSurrogate() || (base + extension).toByteArray().size > MAX_NAME_BYTES)) {
		base = base.dropLast(if (base.length > 1 && base.last().isLowSurrogate()) 2 else 1)
	}
	return (base.trimEnd('.', ' ') + extension).takeIf { it.isNotEmpty() }
}

/**
 * Where downloads wait to be shared: a folder for this run of the app inside cache/Downloads,
 * the folder FileProvider shares from. Earlier runs' downloads are cleared when it is first used,
 * and each download offered replaces the one offered before, so they never pile up. Deleting is
 * done off the main thread, and finishes whatever becomes of the page that asked for it.
 */
internal class DownloadsFolder(root: File, private val scope: CoroutineScope) {
	private val run = File(root, UUID.randomUUID().toString())
	private var offered: File? = null

	init {
		// Only earlier runs' folders: this run's downloads may already be under way.
		cleanUp { root.listFiles()?.filter { it != run }?.forEach { it.deleteRecursively() } }
	}

	/** A folder of its own for one download. */
	fun newFolder(): File = File(run, UUID.randomUUID().toString())

	/** A download is offered to share: the one offered before it isn't needed any more. */
	@MainThread
	fun offer(file: File) {
		val folder = file.parentFile
		val previous = offered
		offered = folder
		if (previous != null && previous != folder) cleanUp { previous.deleteRecursively() }
	}

	/** Runs clean-up off the main thread. */
	fun cleanUp(work: () -> Unit) {
		scope.launch {
			try {
				work()
			} catch (error: Exception) {
				// What can't be removed now goes with the next run's clearing.
			}
		}
	}

	companion object {
		private var shared: DownloadsFolder? = null

		/** The app's one folder, cleared of earlier runs' downloads the first time it is asked for. */
		@MainThread
		fun of(context: Context): DownloadsFolder = shared ?: DownloadsFolder(
			File(context.applicationContext.cacheDir, "Downloads"),
			CoroutineScope(SupervisorJob() + Dispatchers.IO),
		).also { shared = it }
	}
}

/**
 * Downloads a page makes from data only it holds. A blob's bytes exist only inside the page, and
 * the name its link gave a blob: or data: download isn't passed on by WebView, so a script in the
 * page ([SCRIPT]) hands them over, through a channel WebView gives only to the page's own origin.
 * The app asks about one download at a time, the one WebView just reported, and only of the main
 * frame; the page can send nothing it wasn't asked for, and nothing beyond the size it announced
 * or the limit.
 */
@MainThread
internal class PageDownloads(
	private val scope: CoroutineScope,
	private val folder: DownloadsFolder,
	private val onSaved: (File) -> Unit,
	private val limit: Long = MAX_PAGE_DOWNLOAD_BYTES,
	private val io: CoroutineDispatcher = Dispatchers.IO,
) {
	/** WebView's rules for the page's own origin at each of the Umbrel's addresses: the only ones listened to. */
	var origins: Set<String> = emptySet()
		private set

	private class Frame(val origin: String, val reply: (String) -> Unit)

	private class Transfer(val id: Long, val origin: String, val reply: (String) -> Unit, val file: BlobFile) {
		var announced = false
		var busy = false
		var expiry: Job? = null
	}

	private class Naming(val id: Long, val origin: String, val answer: CompletableDeferred<String?>)

	// The main frame as it last said it was ready: the page asked about each download.
	private var mainFrame: Frame? = null
	private var transfer: Transfer? = null
	private var naming: Naming? = null
	private var lastId = 0L

	/**
	 * Follows the page to a location it loads: its own origin there becomes the only one listened
	 * to. True when that changed, and the channel has to be put in again.
	 */
	fun follow(url: Uri, hosts: Set<String>): Boolean {
		val rules = originRules(url, hosts)
		if (rules == origins) return false
		origins = rules
		reset()
		return true
	}

	/**
	 * The main frame to ask about a download, when it shows the page's own origin and so does the
	 * page on screen; for a blob, the blob must be that origin's too.
	 */
	private fun frameFor(pageUrl: Uri?, owner: String? = null): Frame? {
		val frame = mainFrame ?: return null
		if (frame.origin != originOf(pageUrl) || owner != null && owner != frame.origin) return null
		if (origins.none { originOf(it.toUri()) == frame.origin }) return null
		return frame
	}

	/** Asks the page for the bytes of a blob: download WebView just reported. */
	fun read(url: String, pageUrl: Uri?, contentDisposition: String?, mimeType: String?, contentLength: Long) {
		val frame = frameFor(pageUrl, owner = blobOrigin(url) ?: return) ?: return
		if (contentLength > limit) return
		discard()
		val transfer = Transfer(++lastId, frame.origin, frame.reply, BlobFile(folder.newFolder(), contentDisposition, mimeType, limit))
		this.transfer = transfer
		transfer.reply("""{"read":${JsonPrimitive(url)},"id":${transfer.id}}""")
		expire(transfer)
	}

	/**
	 * What the page's link named a data: download WebView just reported, if the page clicked one
	 * moments ago; null when it didn't, can't be asked, or doesn't answer promptly.
	 */
	suspend fun nameOf(url: String, pageUrl: Uri?): String? {
		val frame = frameFor(pageUrl) ?: return null
		naming?.answer?.complete(null)
		val naming = Naming(++lastId, frame.origin, CompletableDeferred())
		this.naming = naming
		frame.reply("""{"name":${JsonPrimitive(url)},"id":${naming.id}}""")
		return try {
			withTimeoutOrNull(NAME_TIMEOUT_MILLIS) { naming.answer.await() }
		} finally {
			if (this.naming === naming) this.naming = null
		}
	}

	/** A message from the page's script. */
	fun receive(data: String, sourceOrigin: Uri, isMainFrame: Boolean, reply: (String) -> Unit) {
		// Frames inside the page, even on its own origin, are never asked for anything.
		if (!isMainFrame) return
		val origin = originOf(sourceOrigin) ?: return
		if (!data.startsWith("{")) return receiveSlice(data, origin)
		if (data.length > MAX_MESSAGE_CHARS) return
		val message = try {
			Json.parseToJsonElement(data) as? JsonObject
		} catch (error: IllegalArgumentException) {
			null
		} ?: return
		val id = message.long("id")
		if (message.boolean("ready") == true) {
			// A new document: whatever the last one was doing went with it.
			discard()
			naming?.answer?.complete(null)
			mainFrame = Frame(origin, reply)
			return
		}
		naming?.takeIf { it.origin == origin && it.id == id && "named" in message }?.let {
			it.answer.complete(message.string("named"))
			return
		}
		val transfer = transfer?.takeIf { it.origin == origin && it.id == id } ?: return
		val size = message.long("size")
		when {
			message.boolean("failed") == true || transfer.announced || transfer.busy || size == null -> discard()
			else -> {
				transfer.announced = true
				write(transfer) { transfer.file.begin(size, message.string("name"), message.string("type")) }
			}
		}
	}

	/** A slice of the bytes, as "id:base64". */
	private fun receiveSlice(data: String, origin: String) {
		val transfer = transfer ?: return
		val separator = data.take(24).indexOf(':')
		if (transfer.origin != origin || separator < 0 || data.substring(0, separator) != transfer.id.toString()) return
		// The page sends each slice when asked, after the last one is written; any other ends it.
		if (!transfer.announced || transfer.busy) return discard()
		write(transfer) { transfer.file.append(data.substring(separator + 1)) }
	}

	private fun write(transfer: Transfer, step: () -> Boolean) {
		transfer.busy = true
		transfer.expiry?.cancel()
		scope.launch {
			val written = withContext(io) {
				try {
					step()
				} catch (error: Exception) {
					false
				}
			}
			transfer.busy = false
			// Discarded meanwhile, and its file with it.
			if (this@PageDownloads.transfer !== transfer) return@launch
			when {
				!written -> discard()
				transfer.file.isComplete -> {
					this@PageDownloads.transfer = null
					transfer.file.file?.let(onSaved)
				}
				else -> {
					transfer.reply("""{"next":${transfer.id}}""")
					expire(transfer)
				}
			}
		}
	}

	// A page that stops sending partway doesn't leave a download hanging.
	private fun expire(transfer: Transfer) {
		transfer.expiry?.cancel()
		transfer.expiry = scope.launch {
			delay(TRANSFER_TIMEOUT_MILLIS)
			if (this@PageDownloads.transfer === transfer) discard()
		}
	}

	/** Ends the download being read, if any, keeping nothing of it, and tells the page to stop. */
	private fun discard() {
		val transfer = transfer ?: return
		transfer.reply("""{"stop":${transfer.id}}""")
		drop(transfer)
	}

	private fun drop(transfer: Transfer) {
		if (this.transfer === transfer) this.transfer = null
		transfer.expiry?.cancel()
		// Stops it at once; removing what it wrote may wait for a slice being written.
		transfer.file.discard()
		folder.cleanUp(transfer.file::clean)
	}

	/** The web view or the page's origin changed: nothing from before carries over. */
	fun reset() {
		transfer?.let(::drop)
		naming?.answer?.complete(null)
		mainFrame = null
	}

	companion object {
		/** The name the page's script reaches the app by. */
		const val CHANNEL = "umbrelDownload"

		private const val TRANSFER_TIMEOUT_MILLIS = 30_000L
		private const val NAME_TIMEOUT_MILLIS = 1_000L

		// How long a clicked link's blob and name are held. The app asks within a second of the
		// click; nothing is held longer than this.
		private const val CLICKED_LINK_MILLIS = 10_000

		/**
		 * WebView's rules for a page's own origin: where it was opened, at each of the Umbrel's
		 * addresses, so the same app reached another way still counts. None off the Umbrel.
		 */
		fun originRules(url: Uri, hosts: Set<String>): Set<String> {
			val host = url.host?.let(BrowserContext::normalized) ?: return emptySet()
			if (url.scheme?.lowercase() != "https" || host !in hosts) return emptySet()
			val port = url.port.takeIf { it > 0 && it != 443 }?.let { ":$it" }.orEmpty()
			return hosts.map { "https://${BrowserContext.bracketed(it)}$port" }.toSet()
		}

		/** An http(s) address's origin, written the same way whatever its case, brackets or default port. */
		fun originOf(url: Uri?): String? {
			val scheme = url?.scheme?.lowercase()?.takeIf { it == "https" || it == "http" } ?: return null
			val host = url.host?.let(BrowserContext::normalized)?.takeIf { it.isNotEmpty() } ?: return null
			val port = url.port.takeIf { it > 0 } ?: if (scheme == "https") 443 else 80
			return "$scheme://${BrowserContext.bracketed(host)}:$port"
		}

		/** The origin that made a blob: address, which the address names; null for an opaque one. */
		fun blobOrigin(url: String): String? {
			if (!url.startsWith("blob:", ignoreCase = true)) return null
			return originOf(url.substring(5).toUri())
		}

		/**
		 * Runs at the start of each page on the page's own origin, in the top frame only. WebView
		 * reports a download by its address alone, so this keeps what that leaves out, and only
		 * for as long as it might be asked for: the blob behind a blob: link the page clicks
		 * (pages usually revoke the address right after the click, before the app can ask), and
		 * what a clicked blob: or data: link named its file. Blobs the page makes are otherwise
		 * held only weakly, and let go as soon as their address is revoked. The bytes are sent
		 * only when the app asks, a slice per request.
		 */
		val SCRIPT = """
			(() => {
				if (window.top !== window) return
				const channel = window.$CHANNEL
				if (!channel) return
				const created = new Map()
				if (typeof WeakRef === 'function' && typeof FinalizationRegistry === 'function') {
					const collected = new FinalizationRegistry((url) => created.delete(url))
					const createObjectURL = URL.createObjectURL
					const revokeObjectURL = URL.revokeObjectURL
					URL.createObjectURL = function (object) {
						const url = createObjectURL.apply(this, arguments)
						if (object instanceof Blob) {
							created.set(url, new WeakRef(object))
							collected.register(object, url)
						}
						return url
					}
					URL.revokeObjectURL = function (url) {
						revokeObjectURL.apply(this, arguments)
						created.delete(String(url))
					}
				}
				const clicked = new Map()
				const remember = (link) => {
					try {
						if (!(link instanceof HTMLAnchorElement)) return
						const url = link.href
						if (!url.startsWith('blob:') && !url.startsWith('data:')) return
						const entry = { name: link.hasAttribute('download') ? link.download : null }
						if (url.startsWith('blob:')) {
							entry.blob = created.get(url)?.deref()
							// One made elsewhere (a worker, a frame) is fetched while its address still works.
							if (!entry.blob) entry.response = fetch(url).catch(() => null)
						}
						clicked.set(url, entry)
						setTimeout(() => { if (clicked.get(url) === entry) clicked.delete(url) }, $CLICKED_LINK_MILLIS)
					} catch (error) {}
				}
				addEventListener('click', (event) => remember(event.target instanceof Element ? event.target.closest('a') : null), true)
				// Links clicked from script are often never added to the page.
				const click = HTMLElement.prototype.click
				HTMLAnchorElement.prototype.click = function () {
					remember(this)
					return click.apply(this, arguments)
				}
				const dispatchEvent = EventTarget.prototype.dispatchEvent
				HTMLAnchorElement.prototype.dispatchEvent = function (event) {
					if (event instanceof Event && event.type === 'click') remember(this)
					return dispatchEvent.apply(this, arguments)
				}
				const blobFor = async (url) => {
					const entry = clicked.get(url)
					if (entry?.blob) return entry.blob
					const response = await entry?.response
					if (response) return response.blob()
					return created.get(url)?.deref() ?? (await fetch(url)).blob()
				}
				// A stop can arrive while a slice is being read; it still ends that download.
				const waiting = new Map()
				const stopped = new Set()
				const asked = (id) => stopped.has(id) ? Promise.resolve(false) : new Promise((resolve) => waiting.set(id, resolve))
				const base64 = (blob) => new Promise((resolve, reject) => {
					const reader = new FileReader()
					reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1))
					reader.onerror = () => reject(reader.error)
					reader.readAsDataURL(blob)
				})
				const send = async (id, url) => {
					try {
						const blob = await blobFor(url)
						channel.postMessage(JSON.stringify({ id, size: blob.size, type: blob.type, name: clicked.get(url)?.name ?? null }))
						for (let offset = 0; offset < blob.size; offset += $BLOB_SLICE_BYTES) {
							if (!await asked(id)) return
							channel.postMessage(id + ':' + await base64(blob.slice(offset, offset + $BLOB_SLICE_BYTES)))
						}
					} catch (error) {
						channel.postMessage(JSON.stringify({ id, failed: true }))
					}
				}
				channel.addEventListener('message', (event) => {
					let message
					try {
						message = JSON.parse(event.data)
					} catch (error) {
						return
					}
					if (typeof message.read === 'string') return send(message.id, message.read)
					if (typeof message.name === 'string') {
						return channel.postMessage(JSON.stringify({ id: message.id, named: clicked.get(message.name)?.name ?? null }))
					}
					const id = message.next ?? message.stop
					const resolve = waiting.get(id)
					waiting.delete(id)
					if (message.stop !== undefined) stopped.add(id)
					if (resolve) resolve(message.next !== undefined)
				})
				const ready = () => channel.postMessage('{"ready":true}')
				ready()
				addEventListener('pageshow', (event) => { if (event.persisted) ready() })
			})()
		""".trimIndent()
	}
}

/**
 * One blob download written to the cache as its page sends it: first the size, type and name it
 * announces, then the bytes in order, a base64 slice at a time, until that size is reached.
 * Anything that doesn't fit the announcement or the limit is refused. Written off the main thread;
 * [discard] stops it at once from any thread, and [clean], off the main thread, removes its folder.
 */
internal class BlobFile(
	/** A folder of its own, removed with it. */
	private val folder: File,
	private val contentDisposition: String?,
	private val mimeType: String?,
	private val limit: Long = MAX_PAGE_DOWNLOAD_BYTES,
) {
	@Volatile
	var file: File? = null
		private set
	private var output: OutputStream? = null

	@Volatile
	private var size = -1L

	@Volatile
	private var received = 0L

	@Volatile
	private var discarded = false

	val isComplete: Boolean
		get() = !discarded && size >= 0 && received == size

	/** The page's announcement. False refuses the download: more than the limit, or announced already. */
	@Synchronized
	fun begin(size: Long, name: String?, type: String?): Boolean {
		if (discarded || file != null || size !in 0..limit) return false
		val file = File(folder, downloadName(null, contentDisposition, mimeType?.takeIf { it.isNotBlank() } ?: type, name))
		this.file = file
		this.size = size
		folder.mkdirs()
		output = FileOutputStream(file)
		if (size == 0L) close()
		return true
	}

	/** The next slice. False refuses the download: not base64, or past the size announced. */
	@Synchronized
	fun append(slice: String): Boolean {
		val output = output ?: return false
		if (discarded || slice.length > MAX_SLICE_CHARS) return false
		val bytes = try {
			Base64.getDecoder().decode(slice)
		} catch (error: IllegalArgumentException) {
			return false
		}
		if (bytes.isEmpty() || bytes.size > size - received) return false
		output.write(bytes)
		received += bytes.size
		if (received == size) close()
		return true
	}

	/** Stops the download: nothing more is written, and it is never complete. */
	fun discard() {
		discarded = true
	}

	/** Removes everything written, once any slice being written is done. */
	@Synchronized
	fun clean() {
		discarded = true
		try {
			output?.close()
		} catch (error: IOException) {
		}
		output = null
		folder.deleteRecursively()
	}

	private fun close() {
		output?.close()
		output = null
	}
}

// The page builds these messages, so a field may be anything; only the expected kind counts.
private fun JsonObject.string(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
private fun JsonObject.long(name: String): Long? = (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
private fun JsonObject.boolean(name: String): Boolean? = (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull

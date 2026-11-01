package com.umbrel.android.main

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.umbrel.kit.backup.LibraryChangeToken
import com.umbrel.kit.backup.MediaStoreLibrary
import com.umbrel.kit.backup.PhotoLibraryAccess
import com.umbrel.kit.backup.PhotoLibraryCounts
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class PhotoLibraryState(
	val access: PhotoLibraryAccess,
	/** What Library shows: the whole library, or only what backup covers while it's on ([LibraryFilter]). */
	val assets: PhotoLibraryAssets = PhotoLibraryAssets.Empty,
	// False until the first query finishes, so an empty grid never flashes.
	val loaded: Boolean = false,
	/** Every folder in the library, whatever Library shows. */
	val folders: List<LibraryFolder> = emptyList(),
) {
	// A selection of photos counts as access on Android: MediaStore returns just the
	// selection, and backup covers it.
	val canReadLibrary: Boolean get() = access.canReadLibrary
}

/**
 * One live view of the phone's photo library, shared by Home and Library: the port of
 * iOS's PhotoLibraryModel. MediaStore stays the owner of the collection. The query runs off
 * the main thread and is repeated when MediaStore reports a change while the app is in the
 * foreground, or when the app resumes after the library or the access grant changed.
 *
 * Also owns the backup receipts the library views overlay, read through [LibraryBackupReader].
 */
class PhotoLibraryViewModel(context: Context, private val backup: LibraryBackupReader) : ViewModel() {
	private val appContext = context.applicationContext
	private val resolver = appContext.contentResolver
	private val mediaStore = MediaStoreLibrary(appContext)

	private val _state = MutableStateFlow(PhotoLibraryState(access = mediaStore.access))
	val state: StateFlow<PhotoLibraryState> = _state

	val receipts = PhotoBackupReceipts(viewModelScope, backup::backedUp, backup.revisions)

	private val reloads = Channel<Unit>(Channel.CONFLATED)
	private var changeDebounce: Job? = null
	private var loadedToken: LibraryChangeToken? = null

	// The whole library as last read, and what backup leaves out of it; both change on the main thread.
	private var library: List<LocalMediaItem> = emptyList()
	private var filter: LibraryFilter? = null

	// Registered on the main thread so change callbacks can debounce without locking.
	private val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
		override fun onChange(selfChange: Boolean, uri: Uri?) {
			changeDebounce?.cancel()
			// Saving a photo or a burst produces several notifications; reload once they settle.
			changeDebounce = viewModelScope.launch {
				delay(CHANGE_DEBOUNCE_MS)
				reloads.send(Unit)
			}
		}
	}
	private var observing = false

	init {
		viewModelScope.launch {
			for (request in reloads) {
				try {
					reload()
				} catch (cancelled: CancellationException) {
					throw cancelled
				} catch (error: Exception) {
					// MediaStore is unavailable for now; the next change or resume tries again.
				}
			}
		}
		viewModelScope.launch {
			backup.filters.collect {
				filter = it
				if (_state.value.loaded) _state.update { state -> state.copy(assets = PhotoLibraryAssets(shown(), state.assets.revision + 1)) }
			}
		}
	}

	private fun shown(): List<LocalMediaItem> = filter?.let { filter -> library.filter(filter::shows) } ?: library

	/**
	 * The app came to the foreground or a permission dialog closed: Android's guidance is to
	 * re-check access and refresh on resume, since either can change while the app is paused.
	 */
	fun resume() {
		if (!observing) {
			resolver.registerContentObserver(PhotoLibrary.images, true, observer)
			resolver.registerContentObserver(PhotoLibrary.videos, true, observer)
			observing = true
		}
		reloads.trySend(Unit)
	}

	fun pause() {
		changeDebounce?.cancel()
		if (observing) {
			resolver.unregisterContentObserver(observer)
			observing = false
		}
	}

	/**
	 * Requeries only when something changed: the access grant, or MediaStore's change token,
	 * whose generations increase with every change to a volume.
	 */
	private suspend fun reload() {
		val access = mediaStore.access
		if (!access.canReadLibrary) {
			loadedToken = null
			library = emptyList()
			_state.update { it.copy(access = access, assets = PhotoLibraryAssets.Empty, loaded = false, folders = emptyList()) }
			backup.libraryChanged(PhotoLibraryCounts())
			return
		}
		// Read before querying, so a change made during the query triggers another reload.
		val token = withContext(Dispatchers.IO) { mediaStore.changeToken() }
		val current = _state.value
		if (current.loaded && current.access == access && token == loadedToken) return
		val items = PhotoLibrary.query(resolver)
		val (folders, counts) = withContext(Dispatchers.Default) { LibraryFolders.of(items) to LibraryFolders.counts(items) }
		loadedToken = token
		library = items
		_state.update { PhotoLibraryState(access, PhotoLibraryAssets(shown(), it.assets.revision + 1), loaded = true, folders = folders) }
		backup.libraryChanged(counts)
	}

	override fun onCleared() = pause()

	private companion object {
		const val CHANGE_DEBOUNCE_MS = 300L
	}
}

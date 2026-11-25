package com.umbrel.android.main

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import com.umbrel.kit.backup.PhotoBackupFailureReason
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

/** What the ledger holds for an item's current version. */
sealed class BackupReceipt {
	/** Nothing to show: the item is still waiting, or isn't something backup covers. */
	data object None : BackupReceipt()

	/** A completed upload receipt. */
	data object BackedUp : BackupReceipt()

	data class Failed(val reason: PhotoBackupFailureReason) : BackupReceipt()
}

/**
 * Backup receipts for the thumbnails on screen, the port of iOS's PhotoBackupReceiptCache.
 * Cells ask only about items they show; requests made in the same frame are read in one
 * batch off the main thread, and a bounded cache keeps scrolling a large library from
 * holding one entry per item.
 *
 * Every change to the backup state starts a new [generation]: older entries are read again
 * on their next request, and a batch that finishes after a newer generation began never
 * writes its older view into the cache.
 */
class PhotoBackupReceipts(
	scope: CoroutineScope,
	// The receipts of the items that have one, by identifier.
	private val read: suspend (List<LocalMediaItem>) -> Map<String, BackupReceipt>,
	revisions: Flow<Any>,
	private val capacity: Int = 512,
) {
	private class Entry(val receipt: BackupReceipt, val generation: Int)

	private class Request(val item: LocalMediaItem, val generation: Int) {
		val result = CompletableDeferred<BackupReceipt>()
	}

	// Main-thread state: requests come from composition effects and batches resume on the
	// view model's main dispatcher.
	private val entries = LinkedHashMap<String, Entry>()
	private val requests = HashMap<String, Request>()
	private val pending = ArrayList<Request>()
	private val wake = Channel<Unit>(Channel.CONFLATED)

	/** Observable so cells re-request when the backup state changes. */
	var generation by mutableIntStateOf(0)
		private set

	init {
		scope.launch { revisions.collect { generation++ } }
		scope.launch {
			for (signal in wake) flush()
		}
	}

	/** The item's receipt, if it's already known for the current backup state. */
	fun cached(item: LocalMediaItem): BackupReceipt? =
		entries[item.localIdentifier]?.takeIf { it.generation == generation }?.receipt

	/** The item's receipt, read with others requested alongside it. */
	suspend fun receipt(item: LocalMediaItem): BackupReceipt {
		val id = item.localIdentifier
		entries[id]?.let { if (it.generation == generation) return it.receipt }
		requests[id]?.let { if (it.generation == generation) return it.result.await() }
		val request = Request(item, generation)
		requests[id] = request
		pending += request
		wake.trySend(Unit)
		return request.result.await()
	}

	private suspend fun flush() {
		if (pending.isEmpty()) return
		val batch = pending.toList()
		pending.clear()
		val receipts = try {
			read(batch.map { it.item })
		} catch (cancelled: CancellationException) {
			batch.forEach {
				finish(it)
				it.result.cancel(cancelled)
			}
			throw cancelled
		} catch (error: Exception) {
			// A failed read isn't proof that an item lacks a receipt, so nothing is cached.
			batch.forEach {
				finish(it)
				it.result.complete(BackupReceipt.None)
			}
			return
		}
		for (request in batch) {
			val id = request.item.localIdentifier
			val result = receipts[id] ?: BackupReceipt.None
			if (request.generation == generation) store(id, result)
			finish(request)
			request.result.complete(result)
		}
	}

	private fun finish(request: Request) {
		val id = request.item.localIdentifier
		if (requests[id] === request) requests.remove(id)
	}

	private fun store(id: String, receipt: BackupReceipt) {
		entries.remove(id)
		entries[id] = Entry(receipt, generation)
		while (entries.size > capacity) entries.remove(entries.keys.first())
	}

	internal val cachedCount: Int get() = entries.size
}

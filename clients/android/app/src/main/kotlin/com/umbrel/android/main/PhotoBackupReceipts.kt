package com.umbrel.android.main

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

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
	// The identifiers among the items whose current version has a completed upload receipt.
	private val read: suspend (List<LocalMediaItem>) -> Set<String>,
	revisions: Flow<Any>,
	private val capacity: Int = 512,
) {
	private class Entry(val backedUp: Boolean, val generation: Int)

	private class Request(val item: LocalMediaItem, val generation: Int) {
		val result = CompletableDeferred<Boolean>()
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

	/** Whether the item is backed up, if that's already known for the current backup state. */
	fun cachedBackedUp(item: LocalMediaItem): Boolean? =
		entries[item.localIdentifier]?.takeIf { it.generation == generation }?.backedUp

	/** Whether the item is backed up, read with others requested alongside it. */
	suspend fun isBackedUp(item: LocalMediaItem): Boolean {
		val id = item.localIdentifier
		entries[id]?.let { if (it.generation == generation) return it.backedUp }
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
		val backedUp = try {
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
				it.result.complete(false)
			}
			return
		}
		for (request in batch) {
			val id = request.item.localIdentifier
			val result = id in backedUp
			if (request.generation == generation) store(id, result)
			finish(request)
			request.result.complete(result)
		}
	}

	private fun finish(request: Request) {
		val id = request.item.localIdentifier
		if (requests[id] === request) requests.remove(id)
	}

	private fun store(id: String, backedUp: Boolean) {
		entries.remove(id)
		entries[id] = Entry(backedUp, generation)
		while (entries.size > capacity) entries.remove(entries.keys.first())
	}

	internal val cachedCount: Int get() = entries.size
}

package com.umbrel.android.main

import com.umbrel.kit.backup.PhotoBackupFailureReason
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Robolectric for android.net.Uri, which keys every receipt.
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [37])
class PhotoBackupReceiptsTest {
	private fun item(id: Long) = LocalMediaItem(id = id, isVideo = false, takenAtMs = 0, durationMs = null, width = 0, height = 0, generation = 0)

	private class Ledger {
		val reads = mutableListOf<List<Long>>()
		var backedUp = setOf<Long>()
		var couldntBackUp = setOf<Long>()
		var failing = false

		suspend fun read(items: List<LocalMediaItem>): Map<String, BackupReceipt> {
			reads += items.map { it.id }
			if (failing) error("database is locked")
			return buildMap {
				for (item in items) {
					if (item.id in backedUp) put(item.localIdentifier, BackupReceipt.BackedUp)
					if (item.id in couldntBackUp) put(item.localIdentifier, BackupReceipt.Failed(PhotoBackupFailureReason.GENERAL))
				}
			}
		}
	}

	private fun TestScope.receipts(ledger: Ledger, revisions: MutableStateFlow<Int>, capacity: Int = 512) =
		PhotoBackupReceipts(backgroundScope, ledger::read, revisions, capacity).also { runCurrent() }

	@Test
	fun requestsMadeTogetherAreReadInOneBatch() = runTest {
		val ledger = Ledger().apply { backedUp = setOf(1L, 3L) }
		val cache = receipts(ledger, MutableStateFlow(0))
		val results = (1L..3L).map { id -> async { cache.receipt(item(id)) } }
		runCurrent()
		assertEquals(listOf(listOf(1L, 2L, 3L)), ledger.reads)
		assertEquals(listOf(BackupReceipt.BackedUp, BackupReceipt.None, BackupReceipt.BackedUp), results.map { it.await() })
	}

	// The grid marks an item that couldn't back up, which a yes or no can't tell from one
	// that's still waiting.
	@Test
	fun anItemThatCouldntBackUpIsToldApartFromOneStillWaiting() = runTest {
		val ledger = Ledger().apply { couldntBackUp = setOf(2L) }
		val cache = receipts(ledger, MutableStateFlow(0))
		val results = (1L..2L).map { id -> async { cache.receipt(item(id)) } }
		runCurrent()
		assertEquals(listOf(BackupReceipt.None, BackupReceipt.Failed(PhotoBackupFailureReason.GENERAL)), results.map { it.await() })
		assertEquals(BackupReceipt.Failed(PhotoBackupFailureReason.GENERAL), cache.cached(item(2)))
	}

	@Test
	fun cachedReceiptsAreNotReadAgain() = runTest {
		val ledger = Ledger().apply { backedUp = setOf(1L) }
		val cache = receipts(ledger, MutableStateFlow(0))
		val first = async { cache.receipt(item(1)) }
		runCurrent()
		first.await()
		assertEquals(BackupReceipt.BackedUp, cache.receipt(item(1)))
		assertEquals(1, ledger.reads.size)
	}

	// The viewer shows a known status from its first frame, so it must be readable without
	// waiting, and only while it's still current.
	@Test
	fun aKnownReceiptIsAvailableAtOnceUntilTheBackupChanges() = runTest {
		val ledger = Ledger().apply { backedUp = setOf(1L) }
		val revisions = MutableStateFlow(0)
		val cache = receipts(ledger, revisions)
		assertNull(cache.cached(item(1)))
		val read = async { cache.receipt(item(1)) }
		runCurrent()
		read.await()
		assertEquals(BackupReceipt.BackedUp, cache.cached(item(1)))
		revisions.value = 1
		runCurrent()
		assertNull(cache.cached(item(1)))
	}

	@Test
	fun duplicateRequestsShareOneRead() = runTest {
		val ledger = Ledger()
		val cache = receipts(ledger, MutableStateFlow(0))
		val a = async { cache.receipt(item(5)) }
		val b = async { cache.receipt(item(5)) }
		runCurrent()
		a.await()
		b.await()
		assertEquals(listOf(listOf(5L)), ledger.reads)
	}

	@Test
	fun aBackupChangeReadsReceiptsAgain() = runTest {
		val ledger = Ledger()
		val revisions = MutableStateFlow(0)
		val cache = receipts(ledger, revisions)
		val before = async { cache.receipt(item(1)) }
		runCurrent()
		assertEquals(BackupReceipt.None, before.await())

		ledger.backedUp = setOf(1L)
		val generation = cache.generation
		revisions.value = 1
		runCurrent()
		assertEquals(generation + 1, cache.generation)
		val after = async { cache.receipt(item(1)) }
		runCurrent()
		assertEquals(BackupReceipt.BackedUp, after.await())
		assertEquals(2, ledger.reads.size)
	}

	@Test
	fun aReadThatFinishesAfterAChangeIsNotCached() = runTest {
		val ledger = Ledger()
		val revisions = MutableStateFlow(0)
		val cache = receipts(ledger, revisions)
		val stale = async { cache.receipt(item(1)) }
		// The backup state changes before the queued batch runs.
		revisions.value = 1
		runCurrent()
		assertEquals(BackupReceipt.None, stale.await())
		ledger.backedUp = setOf(1L)
		val fresh = async { cache.receipt(item(1)) }
		runCurrent()
		assertEquals(BackupReceipt.BackedUp, fresh.await())
	}

	@Test
	fun failedReadsAreNotCached() = runTest {
		val ledger = Ledger().apply { failing = true }
		val cache = receipts(ledger, MutableStateFlow(0))
		val failed = async { cache.receipt(item(1)) }
		runCurrent()
		assertEquals(BackupReceipt.None, failed.await())
		ledger.failing = false
		ledger.backedUp = setOf(1L)
		val retried = async { cache.receipt(item(1)) }
		runCurrent()
		assertEquals(BackupReceipt.BackedUp, retried.await())
	}

	@Test
	fun theCacheKeepsOnlyTheMostRecentEntries() = runTest {
		val ledger = Ledger()
		val cache = receipts(ledger, MutableStateFlow(0), capacity = 2)
		for (id in 1L..3L) {
			val read = async { cache.receipt(item(id)) }
			runCurrent()
			read.await()
		}
		assertEquals(2, cache.cachedCount)
		val evicted = async { cache.receipt(item(1)) }
		runCurrent()
		evicted.await()
		assertEquals(listOf(1L), ledger.reads.last())
		assertEquals(4, ledger.reads.size)
		// 3 is still cached.
		cache.receipt(item(3))
		assertEquals(4, ledger.reads.size)
	}
}

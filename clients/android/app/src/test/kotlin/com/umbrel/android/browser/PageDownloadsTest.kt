package com.umbrel.android.browser

import android.net.Uri
import android.webkit.MimeTypeMap
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File
import java.util.Base64

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [37])
class PageDownloadsTest {
	@get:Rule
	val folder = TemporaryFolder()

	@Before
	fun mimeTypes() {
		shadowOf(MimeTypeMap.getSingleton()).apply {
			addExtensionMimeTypeMapping("csv", "text/csv")
			addExtensionMimeTypeMapping("pdf", "application/pdf")
			addExtensionMimeTypeMapping("png", "image/png")
			addExtensionMimeTypeMapping("txt", "text/plain")
		}
	}

	// ── data: ──

	private fun text(url: String, limit: Long = MAX_PAGE_DOWNLOAD_BYTES) = decodeDataUrl(url, limit)?.let { String(it.bytes) }

	@Test
	fun dataAddressesArePercentDecodedAndBase64DecodedAsBrowsersDo() {
		assertEquals("a,b\n1,2\n", text("data:text/csv;base64,YSxiCjEsMgo="))
		// Unpadded, a marker in capitals after a space, and whitespace in the body.
		assertEquals("hi", text("data:text/plain;charset=utf-8; BASE64,aG k"))
		// The body is percent-decoded before base64.
		assertEquals("hi", text("data:image/png;base64,aGk%3D"))
		assertEquals("hello world ✓", text("data:,hello%20world%20%E2%9C%93"))
		assertEquals("✓", text("data:,✓"))
		// A % that starts no escape is kept as it is, and a fragment is no part of the data.
		assertEquals("100%%zz", text("data:,100%25%zz"))
		assertEquals("a", text("data:text/plain,a#b"))
		assertEquals("", text("data:,"))
	}

	@Test
	fun malformedDataAddressesAreRefused() {
		assertNull(decodeDataUrl("data:text/plain;base64,a"))
		assertNull(decodeDataUrl("data:text/plain;base64,a*b="))
		assertNull(decodeDataUrl("data:text/plain;base64,aG=k"))
		assertNull(decodeDataUrl("data:text/plain"))
		assertNull(decodeDataUrl("https://umbrel.local/a.csv"))
		assertNull(decodeDataUrl("blob:https://umbrel.local/0b3c"))
	}

	@Test
	fun dataAddressesGiveTheirOwnTypeOrPlainText() {
		assertEquals("text/csv", decodeDataUrl("data:Text/CSV;charset=utf-8,a")?.mimeType)
		assertEquals("image/png", decodeDataUrl("data:image/png;base64,aGk=")?.mimeType)
		assertEquals("text/plain", decodeDataUrl("data:,a")?.mimeType)
		assertEquals("text/plain", decodeDataUrl("data:;charset=utf-8,a")?.mimeType)
		assertEquals("text/plain", decodeDataUrl("data:nonsense,a")?.mimeType)
	}

	@Test
	fun dataAddressesOverTheLimitAreRefused() {
		assertEquals("abcd", text("data:,abcd", limit = 4))
		assertNull(text("data:,abcd", limit = 3))
		assertNull(text("data:;base64,YWJjZA==", limit = 3))
	}

	// ── Names ──

	@Test
	fun pageDownloadsAreNamedByTheirLinkOrElseByTheirType() {
		// A data: or blob: address has no name in it.
		assertEquals("downloadfile.csv", downloadName(null, null, "text/csv"))
		assertEquals("downloadfile.csv", downloadName("data:text/csv,a/b.exe", null, "text/csv"))
		assertEquals("downloadfile.csv", downloadName(null, null, "text/csv", suggested = ""))
		assertEquals("report.csv", downloadName(null, null, "text/csv", suggested = "report.csv"))
		// The page's own extension stands even when the type differs; one is added only when missing.
		assertEquals("report.csv", downloadName(null, null, "text/plain", suggested = "report.csv"))
		assertEquals("report.csv", downloadName(null, null, "text/csv;charset=utf-8", suggested = "report"))
		assertEquals("README", downloadName(null, null, null, suggested = "README"))
		assertEquals("passwd", downloadName(null, null, null, suggested = "../../etc/passwd"))
		// Web addresses are named as before.
		assertEquals("report final.pdf", downloadName("https://umbrel.local/files/report%20final.pdf", null, "application/pdf"))
	}

	@Test
	fun namesAreOnePlainFileName() {
		// No folders, and nothing hidden.
		assertEquals("passwd", plainFileName("../../etc/passwd"))
		assertEquals("env", plainFileName("..\\.env"))
		assertNull(plainFileName(".."))
		assertNull(plainFileName(" / "))
		// Characters other apps' storage refuses are replaced; ones that hide or reorder text go.
		assertEquals("a_b_c_.txt", plainFileName("a:b|c?.txt"))
		assertEquals("photogpj.exe", plainFileName("photo\u202Egpj.exe"))
		assertEquals("ab.txt", plainFileName("a\u0000b\n.txt"))
	}

	@Test
	fun longNamesAreShortenedToFitKeepingTheirExtension() {
		val long = plainFileName("a".repeat(300) + ".csv")!!
		assertEquals(255, long.toByteArray().size)
		assertTrue(long.endsWith(".csv"))
		// Never in the middle of a character.
		val emoji = plainFileName("😀".repeat(100) + ".png")!!
		assertTrue(emoji.toByteArray().size <= 255)
		assertTrue(emoji.endsWith(".png"))
		assertEquals(emoji, String(emoji.toByteArray()))
		val cut = plainFileName("a".repeat(254) + "😀😀")!!
		assertEquals("a".repeat(254), cut)
	}

	// ── Origins ──

	@Test
	fun aPagesOwnOriginIsWhereItOpenedAtEachOfTheUmbrelsAddresses() {
		val hosts = setOf("umbrel.local", "192.168.1.5", "fd7a::1")
		assertEquals(
			setOf("https://umbrel.local:2000", "https://192.168.1.5:2000", "https://[fd7a::1]:2000"),
			PageDownloads.originRules(Uri.parse("https://192.168.1.5:2000/files"), hosts),
		)
		assertEquals(
			setOf("https://umbrel.local", "https://192.168.1.5", "https://[fd7a::1]"),
			PageDownloads.originRules(Uri.parse("https://UMBREL.local/"), hosts),
		)
		// Nothing off the Umbrel, and nothing over plain HTTP.
		assertEquals(emptySet<String>(), PageDownloads.originRules(Uri.parse("https://example.com/"), hosts))
		assertEquals(emptySet<String>(), PageDownloads.originRules(Uri.parse("http://umbrel.local:2000/"), hosts))
	}

	@Test
	fun aBlobBelongsToTheOriginItsAddressNames() {
		assertEquals("https://umbrel.local:2000", PageDownloads.blobOrigin("blob:https://umbrel.local:2000/0b3c"))
		assertEquals("https://umbrel.local:443", PageDownloads.blobOrigin("blob:https://UMBREL.local/0b3c"))
		assertEquals("https://[fd7a::1]:443", PageDownloads.blobOrigin("blob:https://[fd7a::1]/0b3c"))
		// One made by a sandboxed frame, or by anything that isn't a web page, has none.
		assertNull(PageDownloads.blobOrigin("blob:null/0b3c"))
		assertNull(PageDownloads.blobOrigin("blob:file:///sdcard/0b3c"))
		assertNull(PageDownloads.blobOrigin("blob:ftp://umbrel.local/0b3c"))
		assertNull(PageDownloads.blobOrigin("blob:blob:https://umbrel.local/0b3c"))
		assertNull(PageDownloads.blobOrigin("https://umbrel.local/0b3c"))
	}

	// ── The page's channel ──

	private val page = Uri.parse("https://umbrel.local:2000")
	private val hosts = setOf("umbrel.local", "192.168.1.5")
	private val blob = "blob:https://umbrel.local:2000/0b3c"
	private val ready = """{"ready":true}"""
	private val saved = mutableListOf<File>()
	private val sent = mutableListOf<String>()
	private val reply: (String) -> Unit = { sent += it }

	private fun TestScope.downloads(limit: Long = 1024) =
		PageDownloads(backgroundScope, DownloadsFolder(folder.root, backgroundScope), { saved += it }, limit, StandardTestDispatcher(testScheduler))
			.apply { follow(page, hosts) }

	private fun base64(text: String) = Base64.getEncoder().encodeToString(text.toByteArray())

	private fun TestScope.leftBehind(): List<File> {
		runCurrent()
		return folder.root.walk().filter { it.isFile }.toList()
	}

	@Test
	fun aBlobIsReadFromThePageThatMadeItASliceAtATime() = runTest {
		val downloads = downloads()
		downloads.receive(ready, page, true, reply)
		downloads.read(blob, Uri.parse("https://192.168.1.5:2000/export"), "", "text/csv", 10)
		assertTrue(sent.isEmpty())
		downloads.read(blob, Uri.parse("https://umbrel.local:2000/export"), "", "text/csv", 10)
		assertEquals("""{"read":"$blob","id":1}""", sent.single())
		downloads.receive("""{"id":1,"size":10,"type":"text/csv","name":"export.csv"}""", page, true, reply)
		runCurrent()
		assertEquals("""{"next":1}""", sent.last())
		downloads.receive("1:" + base64("hello"), page, true, reply)
		runCurrent()
		assertEquals(listOf("""{"next":1}""", """{"next":1}"""), sent.drop(1))
		assertTrue(saved.isEmpty())
		downloads.receive("1:" + base64("world"), page, true, reply)
		runCurrent()
		assertEquals("export.csv", saved.single().name)
		assertEquals("helloworld", saved.single().readText())
		assertEquals(3, sent.size)
	}

	@Test
	fun onlyTheMainFrameShowingThePagesOwnOriginIsAsked() = runTest {
		val downloads = downloads()
		// A frame inside the page, even on its own origin, is never the one asked.
		downloads.receive(ready, page, isMainFrame = false, reply)
		downloads.read(blob, page, null, null, -1)
		assertNull(downloads.nameOf("data:,a", page))
		assertTrue(sent.isEmpty())
		// Nor is another app's page, should it ever reach the channel.
		val other = Uri.parse("https://umbrel.local:3000")
		downloads.receive(ready, other, true, reply)
		downloads.read("blob:https://umbrel.local:3000/0b3c", other, null, null, -1)
		assertNull(downloads.nameOf("data:,a", other))
		assertTrue(sent.isEmpty())
		downloads.receive(ready, page, true, reply)
		// A blob another origin made (another app, another site, a sandboxed frame), or one
		// from a page no longer on screen.
		downloads.read("blob:https://umbrel.local:3000/0b3c", page, null, null, -1)
		downloads.read("blob:https://example.com/0b3c", page, null, null, -1)
		downloads.read("blob:null/0b3c", page, null, null, -1)
		downloads.read(blob, Uri.parse("https://example.com/"), null, null, -1)
		downloads.read(blob, null, null, null, -1)
		assertNull(downloads.nameOf("data:,a", Uri.parse("https://example.com/")))
		assertTrue(sent.isEmpty())
	}

	@Test
	fun aPageCanSendNothingItWasNotAskedFor() = runTest {
		val downloads = downloads()
		downloads.receive(ready, page, true, reply)
		// No download under way: an announcement and its bytes go nowhere.
		downloads.receive("""{"id":1,"size":5,"name":"app.apk"}""", page, true, reply)
		downloads.receive("1:" + base64("hello"), page, true, reply)
		assertTrue(leftBehind().isEmpty())
		downloads.read(blob, page, null, null, -1)
		// From another frame, another origin, or for another download, nothing counts.
		downloads.receive("""{"id":1,"size":5}""", page, isMainFrame = false, reply)
		downloads.receive("""{"id":1,"size":5}""", Uri.parse("https://umbrel.local:3000"), true, reply)
		downloads.receive("""{"id":2,"size":5}""", page, true, reply)
		assertTrue(leftBehind().isEmpty())
		// A slice sent before it was asked for ends the download.
		downloads.receive("""{"id":1,"size":10}""", page, true, reply)
		downloads.receive("1:" + base64("hello"), page, true, reply)
		runCurrent()
		assertEquals("""{"stop":1}""", sent.last())
		assertTrue(saved.isEmpty())
		assertTrue(leftBehind().isEmpty())
	}

	@Test
	fun aBlobIsNeverWrittenPastTheLimitOrItsAnnouncedSize() = runTest {
		val downloads = downloads(limit = 8)
		downloads.receive(ready, page, true, reply)
		// Over the limit by WebView's own count: the page isn't even asked.
		downloads.read(blob, page, null, null, 9)
		assertTrue(sent.isEmpty())
		// Over the limit by the page's announcement.
		downloads.read(blob, page, null, null, -1)
		downloads.receive("""{"id":1,"size":9}""", page, true, reply)
		runCurrent()
		assertEquals("""{"stop":1}""", sent.last())
		// More bytes than announced.
		downloads.read(blob, page, null, null, -1)
		downloads.receive("""{"id":2,"size":4}""", page, true, reply)
		runCurrent()
		assertEquals("""{"next":2}""", sent.last())
		downloads.receive("2:" + base64("hello"), page, true, reply)
		runCurrent()
		assertEquals("""{"stop":2}""", sent.last())
		assertTrue(saved.isEmpty())
		assertTrue(leftBehind().isEmpty())
	}

	@Test
	fun slicesOfAnEarlierDownloadNeverLandInALaterOne() = runTest {
		val downloads = downloads()
		downloads.receive(ready, page, true, reply)
		downloads.read(blob, page, null, null, -1)
		downloads.receive("""{"id":1,"size":5}""", page, true, reply)
		runCurrent()
		// The user starts another download before the first finishes.
		downloads.read(blob, page, null, null, -1)
		assertEquals("""{"stop":1}""", sent[sent.size - 2])
		downloads.receive("""{"id":2,"size":5,"name":"second.txt"}""", page, true, reply)
		runCurrent()
		downloads.receive("1:" + base64("first"), page, true, reply)
		runCurrent()
		downloads.receive("2:" + base64("again"), page, true, reply)
		runCurrent()
		assertEquals("again", saved.single().readText())
		assertEquals(listOf(saved.single()), leftBehind())
	}

	@Test
	fun aPageThatStopsSendingLeavesNothingBehind() = runTest {
		val downloads = downloads()
		downloads.receive(ready, page, true, reply)
		downloads.read(blob, page, null, null, -1)
		downloads.receive("""{"id":1,"size":10}""", page, true, reply)
		runCurrent()
		downloads.receive("1:" + base64("hello"), page, true, reply)
		assertEquals(1, leftBehind().size)
		advanceTimeBy(30_001)
		assertEquals("""{"stop":1}""", sent.last())
		assertTrue(leftBehind().isEmpty())
		// Nor does a page that says it couldn't read the blob, or moves on to another document.
		downloads.read(blob, page, null, null, -1)
		downloads.receive("""{"id":2,"failed":true}""", page, true, reply)
		assertEquals("""{"stop":2}""", sent.last())
		downloads.read(blob, page, null, null, -1)
		downloads.receive("""{"id":3,"size":10}""", page, true, reply)
		runCurrent()
		downloads.receive(ready, page, true, reply)
		assertEquals("""{"stop":3}""", sent.last())
		assertTrue(leftBehind().isEmpty())
		assertTrue(saved.isEmpty())
	}

	@Test
	fun aDataLinksNameComesFromTheMainFrameOnlyAndOnlyIfItAnswersPromptly() = runTest {
		val downloads = downloads()
		downloads.receive(ready, page, true, reply)
		val asked = async { downloads.nameOf("data:image/png;base64,aGk=", page) }
		runCurrent()
		assertEquals("""{"name":"data:image/png;base64,aGk=","id":1}""", sent.single())
		// Another frame, another origin, or another question can't answer it.
		downloads.receive("""{"id":1,"named":"frame.png"}""", page, isMainFrame = false, reply)
		downloads.receive("""{"id":1,"named":"other.png"}""", Uri.parse("https://umbrel.local:3000"), true, reply)
		downloads.receive("""{"id":2,"named":"later.png"}""", page, true, reply)
		downloads.receive("""{"id":1,"named":"chart.png"}""", page, true, reply)
		assertEquals("chart.png", asked.await())
		// A page that doesn't say in time names nothing.
		val unanswered = async { downloads.nameOf("data:,a", page) }
		advanceTimeBy(1_001)
		assertNull(unanswered.await())
		val unnamed = async { downloads.nameOf("data:,a", page) }
		runCurrent()
		downloads.receive("""{"id":3,"named":null}""", page, true, reply)
		assertNull(unnamed.await())
	}

	@Test
	fun theChannelFollowsThePageToItsOwnOriginAndStartsAfresh() = runTest {
		val downloads = downloads()
		assertFalse(downloads.follow(Uri.parse("https://umbrel.local:2000/elsewhere"), hosts))
		downloads.receive(ready, page, true, reply)
		downloads.read(blob, page, null, null, -1)
		downloads.receive("""{"id":1,"size":10}""", page, true, reply)
		assertEquals(1, leftBehind().size)
		// Loading another origin listens only to that one, and what came before is gone.
		assertTrue(downloads.follow(Uri.parse("https://umbrel.local:3000/"), hosts))
		assertEquals(setOf("https://umbrel.local:3000", "https://192.168.1.5:3000"), downloads.origins)
		assertTrue(leftBehind().isEmpty())
		val other = Uri.parse("https://umbrel.local:3000")
		downloads.read("blob:https://umbrel.local:3000/0b3c", other, null, null, -1)
		assertEquals(2, sent.size)
		downloads.receive(ready, other, true, reply)
		downloads.read("blob:https://umbrel.local:3000/0b3c", other, null, null, -1)
		assertEquals("""{"read":"blob:https://umbrel.local:3000/0b3c","id":2}""", sent.last())
	}

	// ── The downloads folder ──

	@Test
	fun downloadsFromEarlierRunsAreClearedAndOnlyTheLatestIsKept() = runTest {
		val earlier = File(folder.root, "earlier-run/0b3c/old.csv").apply { parentFile!!.mkdirs(); writeText("old") }
		val downloads = DownloadsFolder(folder.root, backgroundScope)
		// This run's downloads may start before the clearing gets to run.
		val first = File(downloads.newFolder(), "first.csv").apply { parentFile!!.mkdirs(); writeText("1") }
		runCurrent()
		assertFalse(earlier.exists())
		assertTrue(first.exists())
		downloads.offer(first)
		val second = File(downloads.newFolder(), "second.csv").apply { parentFile!!.mkdirs(); writeText("2") }
		// One still being written isn't touched; the one offered before is removed once the next is.
		runCurrent()
		assertTrue(first.exists())
		downloads.offer(second)
		runCurrent()
		assertFalse(first.parentFile!!.exists())
		assertTrue(second.exists())
		downloads.offer(second)
		runCurrent()
		assertTrue(second.exists())
	}

	@Test
	fun aDiscardedBlobStopsAtOnceAndIsRemovedWhenCleanedUp() {
		val file = BlobFile(File(folder.root, "0b3c"), null, "text/plain", limit = 10)
		assertTrue(file.begin(10, "notes.txt", null))
		assertTrue(file.append(base64("hello")))
		file.discard()
		assertFalse(file.append(base64("world")))
		assertFalse(file.isComplete)
		assertTrue(file.file!!.exists())
		file.clean()
		assertFalse(File(folder.root, "0b3c").exists())
		assertFalse(file.begin(1, "again.txt", null))
	}
}

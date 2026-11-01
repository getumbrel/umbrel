package com.umbrel.android.browser

import android.net.Uri
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.graalvm.polyglot.Context
import org.graalvm.polyglot.Engine
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The script the browser puts in pages, run in a JavaScript engine against a stand-in page and
 * talking to the app's side of the channel, as it would in the web view.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [37])
class PageDownloadsScriptTest {
	@get:Rule
	val folder = TemporaryFolder()

	private val page = Uri.parse("https://umbrel.local:2000")
	private val saved = mutableListOf<File>()
	private val js = page(top = true)

	@After
	fun close() {
		js.close()
	}

	private fun page(top: Boolean): Context = Context.newBuilder("js").engine(engine).build().apply {
		eval("js", FAKE_PAGE)
		if (!top) eval("js", "globalThis.top = {}")
		// Slices of 8 bytes, so a few bytes cross in several.
		eval("js", PageDownloads.SCRIPT.replace(BLOB_SLICE_BYTES.toString(), "8"))
	}

	private fun run(code: String) = js.eval("js", code)

	private fun posted(): List<String> {
		val messages = run("posted.splice(0)")
		return (0 until messages.arraySize).map { messages.getArrayElement(it).asString() }
	}

	private fun deliver(message: String) {
		js.getBindings("js").getMember("deliver").execute(message)
	}

	private fun TestScope.app() =
		PageDownloads(backgroundScope, DownloadsFolder(folder.root, backgroundScope), { saved += it }, io = StandardTestDispatcher(testScheduler))
			.apply { follow(page, setOf("umbrel.local")) }

	// Passes messages both ways until neither side has anything more to say.
	private fun TestScope.settle(app: PageDownloads) {
		repeat(1_000) {
			runCurrent()
			val messages = posted()
			if (messages.isEmpty()) return
			messages.forEach { app.receive(it, page, true, ::deliver) }
		}
		error("The page and the app never settled")
	}

	private fun TestScope.leftBehind(): List<File> {
		runCurrent()
		return folder.root.walk().filter { it.isFile }.toList()
	}

	private fun read(app: PageDownloads, url: String) = app.read(url, page, null, null, -1)

	@Test
	fun aClickedDownloadLinkIsSavedUnderItsNameThoughRevokedAtOnce() = runTest {
		val app = app()
		settle(app)
		val url = run(
			"""
				(() => {
					const url = URL.createObjectURL(new Blob(['hello, slice by slice'], { type: 'text/csv' }))
					link(url, 'export.csv').click()
					URL.revokeObjectURL(url)
					return url
				})()
			""",
		).asString()
		read(app, url)
		settle(app)
		assertEquals("export.csv", saved.single().name)
		assertEquals("hello, slice by slice", saved.single().readText())
	}

	@Test
	fun linksClickedEveryWayAreRemembered() = runTest {
		val app = app()
		settle(app)
		// A tap on something inside a link on the page, which the window sees first.
		val tapped = run(
			"""
				(() => {
					const url = URL.createObjectURL(new Blob(['tapped']))
					new HTMLElement(link(url, 'tapped.txt', true)).click()
					URL.revokeObjectURL(url)
					return url
				})()
			""",
		).asString()
		read(app, tapped)
		settle(app)
		// A link never added to the page, clicked by dispatching an event (as FileSaver.js does).
		val dispatched = run(
			"""
				(() => {
					const url = URL.createObjectURL(new Blob(['dispatched']))
					link(url, 'saved.bin').dispatchEvent(new Event('click'))
					URL.revokeObjectURL(url)
					return url
				})()
			""",
		).asString()
		read(app, dispatched)
		settle(app)
		assertEquals(listOf("tapped.txt" to "tapped", "saved.bin" to "dispatched"), saved.map { it.name to it.readText() })
	}

	@Test
	fun aClickedBlobIsHeldOnlyBriefly() = runTest {
		val app = app()
		settle(app)
		val url = run("(() => { const url = URL.createObjectURL(new Blob(['x'])); link(url, 'x.txt').click(); URL.revokeObjectURL(url); return url })()").asString()
		run("advance(10001)")
		read(app, url)
		settle(app)
		assertTrue(saved.isEmpty())
		assertTrue(leftBehind().isEmpty())
	}

	@Test
	fun aBlobNoLinkWasClickedForIsLetGoWhenRevokedHoweverItsAddressIsGiven() = runTest {
		val app = app()
		settle(app)
		// The page keeps the blobs itself; only their addresses are revoked.
		val urls = run(
			"""
				(() => {
					globalThis.kept = [new Blob(['one']), new Blob(['two'])]
					const first = URL.createObjectURL(kept[0])
					const second = URL.createObjectURL(kept[1])
					URL.revokeObjectURL(first)
					URL.revokeObjectURL({ toString: () => second })
					return [first, second]
				})()
			""",
		)
		for (index in 0 until urls.arraySize) {
			read(app, urls.getArrayElement(index).asString())
			settle(app)
		}
		assertTrue(saved.isEmpty())
	}

	@Test
	fun aBlobRevokedElsewhereIsNotKeptAliveByTheScript() = runTest {
		val app = app()
		settle(app)
		// Made and dropped by the page, its address then revoked by a frame or worker, which the
		// page's own URL.revokeObjectURL never sees.
		val url = run(
			"""
				(() => {
					const blob = new Blob(['made and dropped'])
					globalThis.probe = new WeakRef(blob)
					const url = URL.createObjectURL(blob)
					revokeElsewhere(url)
					return url
				})()
			""",
		).asString()
		for (attempt in 1..50) {
			System.gc()
			if (run("probe.deref() === undefined").asBoolean()) break
			Thread.sleep(10)
		}
		assertTrue("The blob was never collected", run("probe.deref() === undefined").asBoolean())
		read(app, url)
		settle(app)
		assertTrue(saved.isEmpty())
	}

	@Test
	fun aBlobOpenedWithoutALinkIsReadWhileItsAddressWorks() = runTest {
		val app = app()
		settle(app)
		val url = run("globalThis.kept = new Blob(['opened directly']); URL.createObjectURL(kept)").asString()
		read(app, url)
		settle(app)
		assertEquals("opened directly", saved.single().readText())
	}

	@Test
	fun aDataLinkIsNamedByTheLinkTheUserClicked() = runTest {
		val app = app()
		settle(app)
		val url = "data:image/png;base64,aGk="
		run("link('$url', 'chart.png').click()")
		val named = async { app.nameOf(url, page) }
		settle(app)
		assertEquals("chart.png", named.await())
		val unclicked = async { app.nameOf("data:text/plain,other", page) }
		settle(app)
		assertNull(unclicked.await())
		run("advance(10001)")
		val later = async { app.nameOf(url, page) }
		settle(app)
		assertNull(later.await())
	}

	@Test
	fun aStopEndsTheDownloadEvenWhileASliceIsBeingRead() {
		val url = run("URL.createObjectURL(new Blob(['0123456789abcdefghij']))").asString()
		assertEquals(listOf("""{"ready":true}"""), posted())
		deliver("""{"read":"$url","id":7}""")
		assertEquals(listOf("""{"id":7,"size":20,"type":"","name":null}"""), posted())
		// Both arrive before the slice asked for is read.
		run("""deliver('{"next":7}'); deliver('{"stop":7}')""")
		assertEquals(listOf("7:MDEyMzQ1Njc="), posted())
		deliver("""{"next":7}""")
		assertTrue(posted().isEmpty())
		// An address it can't read is reported, not left unanswered.
		deliver("""{"read":"blob:https://umbrel.local:2000/gone","id":8}""")
		assertEquals(listOf("""{"id":8,"failed":true}"""), posted())
	}

	@Test
	fun everythingTheScriptWrapsStillWorksForThePage() {
		val works = run(
			"""
				(() => {
					const blob = new Blob(['page'])
					const url = URL.createObjectURL(blob)
					const before = registered(url) === blob
					URL.revokeObjectURL(url)
					const link = globalThis.link('https://umbrel.local:2000/next')
					let clicks = 0
					link.addEventListener('click', () => clicks++)
					link.click()
					const dispatched = link.dispatchEvent(new Event('click'))
					return before && registered(url) === undefined && clicks === 2 && dispatched === true
				})()
			""",
		)
		assertTrue(works.asBoolean())
	}

	@Test
	fun thePageSaysItIsReadyAgainWhenShownFromTheBackForwardCache() {
		assertEquals(listOf("""{"ready":true}"""), posted())
		run("showPageAgain()")
		assertEquals(listOf("""{"ready":true}"""), posted())
	}

	@Test
	fun nothingRunsInFramesInsideThePage() {
		page(top = false).use { frame ->
			assertEquals(0, frame.eval("js", "posted.length").asInt())
			assertTrue(frame.eval("js", "URL.createObjectURL === original.createObjectURL").asBoolean())
		}
	}

	companion object {
		private val engine: Engine by lazy {
			Engine.newBuilder("js").option("engine.WarnInterpreterOnly", "false").build()
		}

		/**
		 * Just enough of a browser page for the script: a window, links, blobs and their addresses
		 * (fetch resolves an address when called, as browsers do), FileReader, and timers on a
		 * clock the test moves. What the page sends collects in posted; deliver hands it a reply.
		 */
		private val FAKE_PAGE = """
			(() => {
				globalThis.window = globalThis
				globalThis.top = globalThis
				globalThis.posted = []
				let now = 0
				const timers = []
				globalThis.setTimeout = (run, delay) => { timers.push({ at: now + (delay || 0), run }) }
				globalThis.advance = (millis) => {
					now += millis
					for (const timer of timers.filter((it) => it.at <= now)) {
						timers.splice(timers.indexOf(timer), 1)
						timer.run()
					}
				}
				class Event {
					constructor(type) { this.type = type }
				}
				class EventTarget {
					addEventListener(type, listener) { (this.listeners ??= []).push({ type, listener }) }
					dispatchEvent(event) {
						if (!event.target) event.target = this
						// An event on something in the page reaches the window's capturing listeners first.
						if (this.attached) page.notify(event)
						this.notify(event)
						return true
					}
					notify(event) {
						for (const { type, listener } of this.listeners ?? []) if (type === event.type) listener.call(this, event)
					}
				}
				const page = new EventTarget()
				globalThis.addEventListener = (type, listener) => page.addEventListener(type, listener)
				globalThis.showPageAgain = () => page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
				class Element extends EventTarget {
					constructor(parent) {
						super()
						this.parent = parent ?? null
						this.attached = parent?.attached ?? false
					}
					closest() {
						let node = this
						while (node && !(node instanceof HTMLAnchorElement)) node = node.parent
						return node ?? null
					}
				}
				class HTMLElement extends Element {}
				class HTMLAnchorElement extends HTMLElement {
					constructor() {
						super()
						this.attributes = {}
					}
					hasAttribute(name) { return name in this.attributes }
					get href() { return this.attributes.href ?? '' }
					set href(value) { this.attributes.href = String(value) }
					get download() { return this.attributes.download ?? '' }
					set download(value) { this.attributes.download = String(value) }
				}
				// A browser's own click goes straight to the element, not through the page's dispatchEvent.
				const dispatch = EventTarget.prototype.dispatchEvent
				HTMLElement.prototype.click = function () { dispatch.call(this, new Event('click')) }
				Object.assign(globalThis, { Event, EventTarget, Element, HTMLElement, HTMLAnchorElement })
				globalThis.link = (href, download, attached) => {
					const link = new HTMLAnchorElement()
					link.attached = !!attached
					link.href = href
					if (download !== undefined) link.download = download
					return link
				}
				class Blob {
					constructor(parts, options) {
						this.data = (parts ?? []).map((part) => part instanceof Blob ? part.data : String(part)).join('')
						this.type = options?.type ?? ''
					}
					get size() { return this.data.length }
					slice(start, end) { return new Blob([this.data.slice(start, end)]) }
				}
				globalThis.Blob = Blob
				const registry = new Map()
				let made = 0
				globalThis.URL = {
					createObjectURL(blob) {
						const url = 'blob:https://umbrel.local:2000/' + ++made
						registry.set(url, blob)
						return url
					},
					revokeObjectURL(url) { registry.delete(String(url)) },
				}
				globalThis.original = { ...URL }
				globalThis.registered = (url) => registry.get(url)
				// A frame or worker revoking an address: the page's own URL.revokeObjectURL never runs.
				globalThis.revokeElsewhere = (url) => registry.delete(url)
				globalThis.fetch = (url) => {
					const blob = registry.get(String(url))
					return blob ? Promise.resolve({ blob: async () => blob }) : Promise.reject(new TypeError('Failed to fetch'))
				}
				const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
				const base64 = (text) => {
					let out = ''
					for (let i = 0; i < text.length; i += 3) {
						const n = (text.charCodeAt(i) << 16) | ((text.charCodeAt(i + 1) || 0) << 8) | (text.charCodeAt(i + 2) || 0)
						out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63]
						out += i + 1 < text.length ? alphabet[(n >> 6) & 63] : '='
						out += i + 2 < text.length ? alphabet[n & 63] : '='
					}
					return out
				}
				globalThis.FileReader = class {
					readAsDataURL(blob) {
						Promise.resolve().then(() => {
							this.result = 'data:application/octet-stream;base64,' + base64(blob.data)
							this.onload()
						})
					}
				}
				class Channel extends EventTarget {
					postMessage(data) { posted.push(data) }
				}
				globalThis.umbrelDownload = new Channel()
				globalThis.deliver = (data) => umbrelDownload.dispatchEvent(Object.assign(new Event('message'), { data }))
			})()
		""".trimIndent()
	}
}

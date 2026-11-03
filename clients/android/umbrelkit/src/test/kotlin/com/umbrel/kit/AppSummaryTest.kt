package com.umbrel.kit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.net.URI

class AppSummaryTest {
	private fun decode(json: String): Umbreld.AppSummary = Umbreld.json.decodeFromString(Umbreld.AppSummary.serializer(), json)

	@Test
	fun httpsRequirementDecodesAndBuildsSecureUrl() {
		val app = decode("""{"id":"camera","name":"Camera","port":8080,"path":"/web/","requiresHttps":true}""")

		assertEquals(true, app.requiresHttps)
		assertEquals("https://umbrel.local:8080/web/", app.webUrl("umbrel.local", "https"))
	}

	@Test
	fun appWithoutHttpsRequirementStillDecodes() {
		val app = decode("""{"id":"notes","port":3000}""")

		assertNull(app.requiresHttps)
		assertEquals("http://umbrel.local:3000", app.webUrl("umbrel.local"))
	}

	@Test
	fun lifecycleProgressDecodesAndSurvivesCacheCopy() {
		val app = decode("""{"id":"files","state":"updating","progress":42.5}""")

		assertEquals(42.5, app.progress)
		assertEquals(42.5, app.withoutCredentials.progress)
	}

	@Test
	fun relativeAppPathIsNormalized() {
		val app = decode("""{"id":"notes","port":3000,"path":"admin"}""")

		assertEquals("http://umbrel.local:3000/admin", app.webUrl("umbrel.local"))
	}

	@Test
	fun appPathCannotReplaceUrlAuthority() {
		val app = decode("""{"id":"notes","port":3000,"path":"@evil.example/login"}""")
		val url = URI(app.webUrl("umbrel.local")!!)

		assertEquals("umbrel.local", url.host)
		assertNull(url.userInfo)
		assertEquals("/@evil.example/login", url.path)
	}

	@Test
	fun cacheCopyOmitsDefaultCredentials() {
		val app = decode(
			"""{"id":"camera","name":"Camera","port":8080,"credentials":{"defaultUsername":"umbrel","defaultPassword":"secret","showBeforeOpen":true}}""",
		)
		val cached = app.withoutCredentials

		assertEquals(app.id, cached.id)
		assertEquals(app.name, cached.name)
		assertEquals(app.port, cached.port)
		assertNull(cached.credentials)
		assertFalse(Umbreld.json.encodeToString(Umbreld.AppSummary.serializer(), cached).contains("secret"))
	}
}

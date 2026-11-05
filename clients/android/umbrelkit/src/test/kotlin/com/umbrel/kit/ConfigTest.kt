package com.umbrel.kit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ConfigTest {
	@get:Rule
	val temporary = TemporaryFolder()

	@Test
	fun missingConfigIsAnEmptyWritableConfig() {
		val file = temporaryConfigFile()
		val result = Config.load(file)

		assertNull(result.issue)
		assertTrue(result.config.savedDevices.isEmpty())
		result.config.save(device())
		assertTrue(file.exists())
	}

	@Test
	fun corruptConfigIsQuarantinedBeforeRecovery() {
		val file = temporaryConfigFile()
		file.writeText("not-json")

		val result = Config.load(file)

		assertEquals(Config.StorageIssue.CORRUPT_QUARANTINED, result.issue)
		assertFalse(file.exists())
		val siblings = file.parentFile!!.listFiles()!!.filter { it.name.startsWith("config.corrupt-") }
		assertEquals(1, siblings.size)
		assertEquals("not-json", siblings.single().readText())

		result.config.save(device())
		assertEquals(device(), Config.load(file).config.savedDevices["device"])
	}

	@Test
	fun failedSaveDoesNotChangeInMemoryConfig() {
		val blockedParent = File(temporary.root, "blocked").apply { writeBytes(ByteArray(0)) }
		val config = Config.load(File(blockedParent, "config.json")).config

		val error = assertThrows(Config.StorageException::class.java) { config.save(device()) }

		assertEquals(Config.StorageIssue.SAVE_FAILED, error.issue)
		assertTrue(config.savedDevices.isEmpty())
	}

	@Test
	fun unreadableConfigIsNotTreatedAsWritableEmptyState() {
		val file = temporaryConfigFile().apply { mkdirs() }

		val result = Config.load(file)

		assertEquals(Config.StorageIssue.UNREADABLE, result.issue)
		assertThrows(Config.StorageException::class.java) { result.config.save(device()) }
	}

	// Not in the Swift suite: the remaining mutations share save's write-then-publish order.

	@Test
	fun savedDevicesRoundTrip() {
		val file = temporaryConfigFile()
		val config = Config.load(file).config
		val profiled = device().saveAccountProfile("0", "Mayank", "22", "92 52% 41%", "owner")
		config.save(profiled)

		assertEquals(mapOf("device" to profiled), Config.load(file).config.savedDevices)
	}

	@Test
	fun updateSkipsTheWriteWhenNothingChanged() {
		val file = temporaryConfigFile()
		val config = Config.load(file).config
		config.save(device())
		file.delete()

		config.update("device") { it }
		assertFalse(file.exists())

		config.update("device") { it.copy(name = "Kitchen") }
		assertEquals("Kitchen", Config.load(file).config.savedDevices["device"]?.name)
	}

	@Test
	fun removingTheLastDeviceLeavesALoadableEmptyConfig() {
		val file = temporaryConfigFile()
		val config = Config.load(file).config
		config.save(device())

		config.remove("device")

		val reloaded = Config.load(file)
		assertNull(reloaded.issue)
		assertTrue(reloaded.config.savedDevices.isEmpty())
	}

	@Test
	fun failedRemoveAndUpdateKeepTheInMemoryState() {
		val file = temporaryConfigFile()
		val config = Config.load(file).config
		config.save(device())
		file.parentFile!!.setWritable(false)
		try {
			assertThrows(Config.StorageException::class.java) { config.update("device") { it.copy(name = "Kitchen") } }
			assertThrows(Config.StorageException::class.java) { config.remove("device") }
		} finally {
			file.parentFile!!.setWritable(true)
		}

		assertEquals(device(), config.savedDevices["device"])
	}

	// The browser connection choice was removed when umbrelOS moved into the app. A config
	// saved with it still loads, keeping everything else.
	@Test
	fun aConfigWithTheRemovedBrowserConnectionStillLoads() {
		val file = temporaryConfigFile().apply {
			parentFile!!.mkdirs()
			writeText("""{"savedDevices":{"device":{"id":"device","name":"Umbrel","host":"umbrel.local","addresses":["192.168.1.10"],"browserConnection":"tailscale","dashboardUsesHTTPS":true}}}""")
		}

		val result = Config.load(file)

		assertNull(result.issue)
		assertEquals(device().copy(dashboardUsesHTTPS = true), result.config.savedDevices["device"])
	}

	private fun temporaryConfigFile(): File = File(temporary.newFolder(), "config.json")

	private fun device() = SavedDevice(id = "device", name = "Umbrel", host = "umbrel.local", addresses = listOf("192.168.1.10"))
}

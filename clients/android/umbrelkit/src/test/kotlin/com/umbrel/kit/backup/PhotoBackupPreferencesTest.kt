package com.umbrel.kit.backup

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.umbrel.kit.Umbreld
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Port of PhotoBackupPreferenceTests plus the store parts of PhotoBackupCoverageTests. */
@RunWith(AndroidJUnit4::class)
class PhotoBackupPreferencesTest {
	private lateinit var context: Context
	private lateinit var preferences: PhotoBackupPreferences

	@Before
	fun setUp() {
		context = ApplicationProvider.getApplicationContext()
		context.getSharedPreferences(PhotoBackupPreferences.FILE_NAME, Context.MODE_PRIVATE).edit().clear().commit()
		preferences = PhotoBackupPreferences(context)
	}

	@Test
	fun preferencesAreIsolatedByDeviceAndAccount() {
		val owner = PhotoBackupPreference(includesPhotos = true, allowsCellular = true)
		val member = PhotoBackupPreference(includesVideos = true)
		preferences.save(owner, "umbrel", "0", activate = true)
		preferences.save(member, "umbrel", "nate", activate = true)

		assertEquals(owner, preferences.preference("umbrel", "0"))
		assertEquals(member, preferences.preference("umbrel", "nate"))
		assertFalse(preferences.isActive("umbrel", "0"))
		assertTrue(preferences.isActive("umbrel", "nate"))
		assertEquals(PhotoBackupTarget("umbrel", "nate"), preferences.activeTarget)
	}

	@Test
	fun savingAnInactivePreferenceDoesNotReplaceTheActiveTarget() {
		preferences.save(PhotoBackupPreference(includesPhotos = true), "umbrel", "0", activate = true)
		preferences.save(PhotoBackupPreference(includesVideos = true), "umbrel", "nate", activate = false)

		assertTrue(preferences.isActive("umbrel", "0"))
		assertFalse(preferences.isActive("umbrel", "nate"))
	}

	@Test
	fun removingADeviceClearsItsPreferencesAndActiveTarget() {
		preferences.save(PhotoBackupPreference(includesPhotos = true), "umbrel", "nate", activate = true)

		preferences.removeDevice("umbrel")

		assertEquals(PhotoBackupPreference(), preferences.preference("umbrel", "nate"))
		assertFalse(preferences.isActive("umbrel", "nate"))
	}

	@Test
	fun theNewPhoneQuestionIsKeptPerAccountUntilAnswered() {
		preferences.setNewSourceQuestion("Nate’s Pixel", "umbrel", "0")

		assertEquals("Nate’s Pixel", PhotoBackupPreferences(context).newSourceQuestion("umbrel", "0"))
		assertNull(preferences.newSourceQuestion("umbrel", "nate"))
		assertNull(preferences.newSourceQuestion("other", "0"))

		preferences.setNewSourceQuestion(null, "umbrel", "0")
		assertNull(preferences.newSourceQuestion("umbrel", "0"))

		preferences.setNewSourceQuestion("Nate’s Pixel", "umbrel", "0")
		preferences.removeDevice("umbrel")
		assertNull(preferences.newSourceQuestion("umbrel", "0"))
	}

	@Test
	fun aLiveConfigurationRepairsOnlyTheActiveTarget() {
		val preference = PhotoBackupPreference(includesVideos = true, allowsCellular = true)
		preferences.save(preference, "umbrel", "nate", activate = false)

		preferences.reconcileActiveTarget("umbrel", "nate")

		assertTrue(preferences.isActive("umbrel", "nate"))
		assertEquals(preference, preferences.preference("umbrel", "nate"))
	}

	@Test
	fun aDisabledPreferenceCannotBeReactivatedByAStaleConfiguration() {
		preferences.save(PhotoBackupPreference(), "umbrel", "nate", activate = false)

		preferences.reconcileActiveTarget("umbrel", "nate")

		assertFalse(preferences.isActive("umbrel", "nate"))
	}

	@Test
	fun recoveryRetryRequestIsScopedToItsBackupSource() {
		assertTrue(preferences.requestRecoveryRetry("first"))
		assertTrue(preferences.recoveryRetryRequested("first"))

		assertTrue(preferences.requestRecoveryRetry("second"))
		assertFalse(preferences.clearRecoveryRetryRequest("first"))
		assertTrue(preferences.recoveryRetryRequested("second"))
		assertTrue(preferences.clearRecoveryRetryRequest("second"))
		assertFalse(preferences.recoveryRetryRequested("second"))
	}

	@Test
	fun configurationReadDistinguishesMissingFromUnreadable() {
		assertEquals(PhotoBackupPreferences.ConfigurationRead.Missing, preferences.configurationRead())

		context.getSharedPreferences(PhotoBackupPreferences.FILE_NAME, Context.MODE_PRIVATE).edit()
			.putString(PhotoBackupPreferences.KEY_CONFIGURATION, "not-json").commit()
		assertEquals(PhotoBackupPreferences.ConfigurationRead.Unavailable, preferences.configurationRead())
	}

	@Test
	fun aConfigurationSavedByAnEarlierBuildIsRead() {
		context.getSharedPreferences(PhotoBackupPreferences.FILE_NAME, Context.MODE_PRIVATE).edit().putString(
			PhotoBackupPreferences.KEY_CONFIGURATION,
			"""{"deviceId":"umbrel","uploadBaseUrl":"http://100.90.0.1","source":{"id":"source","accountId":"0","name":"Android phone"},""" +
				""""includePhotos":true,"includeVideos":false,"allowsCellularAccess":false}""",
		).commit()

		assertEquals(configuration(), preferences.configuration)

		assertTrue(preferences.save(configuration()))
		assertEquals(configuration(), preferences.configuration)
	}

	@Test
	fun clearingTheConfigurationKeepsCompletedTotals() {
		val statistics = PhotoBackupStatistics(0, 0, 4, 1, 0, 42)
		preferences.save(configuration())
		preferences.publish(PhotoBackupSnapshot(PhotoBackupPhase.UP_TO_DATE, sourceId = "source", statistics = statistics))
		preferences.requestStorageRetry("source")
		preferences.requestRecoveryRetry("source")

		preferences.clearConfiguration()

		assertNull(preferences.configuration)
		assertFalse(preferences.storageRetryRequested("source"))
		assertFalse(preferences.recoveryRetryRequested("source"))
		assertEquals(PhotoBackupPhase.DISABLED, preferences.snapshot.phase)
		assertEquals("source", preferences.snapshot.sourceId)
		assertEquals(statistics, preferences.snapshot.statistics)
	}

	private fun configuration() = PhotoBackupConfiguration(
		"umbrel",
		Umbreld.PhotoBackupSource("source", "0", "Android phone"),
		includePhotos = true,
		includeVideos = false,
		allowsCellularAccess = false,
	)
}

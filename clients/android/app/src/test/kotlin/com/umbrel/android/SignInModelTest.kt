package com.umbrel.android

import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import com.umbrel.kit.Config
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class SignInModelTest {
	private val owner = account("0", "Nate Fretz")
	private val member = account("7", "Satoshi")
	private val session = Umbreld.Session("device", "0", "access", 1L, "grant")

	private var accounts: List<Umbreld.Account> = listOf(owner)
	private var loginResult: () -> Umbreld.Session = { session }
	private var stores = true
	private val logins = mutableListOf<Triple<String, String, String?>>()
	private val browserLogins = mutableListOf<Triple<String, String, String?>>()
	private var browserResult: (Umbreld.Session) -> Umbreld.Session = { it }
	private val stored = mutableListOf<Umbreld.Session>()
	private val events = mutableListOf<String>()

	private fun account(id: String, name: String) = Umbreld.Account(id, name, Umbreld.Wallpaper("1", "259 100% 59%"))

	private fun model(preferredUserId: String? = null) = SignInModel(
		preferredUserId = preferredUserId,
		listAccounts = { accounts },
		login = { userId, password, code ->
			logins += Triple(userId, password, code)
			loginResult()
		},
		storeSession = {
			stored += it
			events += "store"
			stores
		},
		deleteSession = { events += "delete" },
		logout = { events += "logout" },
		browserSignIn = { login, password, code ->
			browserLogins += Triple(login.accountId, password, code)
			events += "browserIn"
			browserResult(login)
		},
		browserSignOut = { events += "browserOut" },
	)

	@Test
	fun singleAccountSelectsItAndFocusesThePassword() = runTest {
		val model = model()
		model.loadAccounts {}
		assertEquals(SignInStep.PASSWORD, model.step)
		assertEquals(owner, model.selectedAccount)
		assertFalse(model.hasMultipleAccounts)
		assertEquals(1, model.passwordFocusRequests)
	}

	@Test
	fun multipleAccountsPreferTheLastAccountThenTheOwner() = runTest {
		accounts = listOf(member, owner)
		val preferred = model(preferredUserId = "7")
		preferred.loadAccounts {}
		assertEquals(member, preferred.selectedAccount)
		// The picker takes focus instead of the keyboard.
		assertEquals(0, preferred.passwordFocusRequests)

		val fallback = model(preferredUserId = "gone")
		fallback.loadAccounts {}
		assertEquals(owner, fallback.selectedAccount)
	}

	@Test
	fun noAccountsMeansSetUpAndAFailedLoadOffersRetry() = runTest {
		accounts = emptyList()
		val model = model()
		model.loadAccounts {}
		assertEquals(SignInStep.SETUP, model.step)

		model.loadAccounts { throw IOException("offline") }
		assertEquals(SignInStep.LOAD_FAILED, model.step)
	}

	@Test
	fun signInStoresTheSessionBeforeTheCallerPersists() = runTest {
		val model = loadedModel()
		model.password.setTextAndPlaceCursorAtEnd("hunter2")
		var signedIn: Pair<Umbreld.Session, Umbreld.Account?>? = null
		assertTrue(model.connect { s, a -> events += "persist"; signedIn = s to a })
		assertEquals(listOf("browserIn", "store", "persist"), events)
		assertEquals(session to owner, signedIn)
		assertEquals(listOf(Triple("0", "hunter2", null)), logins)
		assertFalse(model.loading)
	}

	@Test
	fun emptyPasswordDoesNotSubmit() = runTest {
		val model = loadedModel()
		assertTrue(model.connectDisabled)
		assertFalse(model.connect { _, _ -> error("not called") })
		assertTrue(logins.isEmpty())
	}

	@Test
	fun twoFactorChallengeAsksForTheCodeThenSubmitsIt() = runTest {
		val model = loadedModel()
		model.password.setTextAndPlaceCursorAtEnd("hunter2")
		loginResult = { throw Umbreld.Error(401, "Missing 2FA code") }
		assertFalse(model.connect { _, _ -> error("not called") })
		assertEquals(SignInStep.TWO_FACTOR, model.step)
		assertNull(model.error)
		assertTrue(model.connectDisabled)

		model.twoFactorCode.setTextAndPlaceCursorAtEnd("12345")
		assertFalse(model.twoFactorCodeChanged(model.twoFactorCode.text))
		model.twoFactorCode.setTextAndPlaceCursorAtEnd("123456")
		assertTrue(model.twoFactorCodeChanged(model.twoFactorCode.text))

		loginResult = { session }
		assertTrue(model.connect { _, _ -> })
		assertEquals(Triple("0", "hunter2", "123456"), logins.last())
	}

	@Test
	fun wrongCodeShowsTheErrorAndClearsTheCodeUntilTypingResumes() = runTest {
		val model = loadedModel()
		model.password.setTextAndPlaceCursorAtEnd("hunter2")
		loginResult = { throw Umbreld.Error(401, "Missing 2FA code") }
		model.connect { _, _ -> }
		model.twoFactorCode.setTextAndPlaceCursorAtEnd("000000")
		loginResult = { throw Umbreld.Error(401, "Incorrect 2FA code") }
		assertFalse(model.connect { _, _ -> })
		assertEquals("Incorrect 2FA code", model.error)
		assertEquals("", model.twoFactorCode.text.toString())
		assertEquals(SignInStep.TWO_FACTOR, model.step)

		model.twoFactorCodeChanged("")
		assertEquals("Incorrect 2FA code", model.error)
		model.twoFactorCodeChanged("1")
		assertNull(model.error)
	}

	@Test
	fun unsavableSessionLogsOutAndReportsIt() = runTest {
		val model = loadedModel()
		model.password.setTextAndPlaceCursorAtEnd("hunter2")
		stores = false
		assertFalse(model.connect { _, _ -> error("not called") })
		assertEquals(listOf("browserIn", "store", "browserOut", "logout"), events)
		assertEquals("Couldn’t save your session. Please try again.", model.error)
	}

	@Test
	fun failedPersistenceRollsTheSessionBack() = runTest {
		val model = loadedModel()
		model.password.setTextAndPlaceCursorAtEnd("hunter2")
		assertFalse(model.connect { _, _ -> throw Config.StorageException(Config.StorageIssue.SAVE_FAILED) })
		assertEquals(listOf("browserIn", "store", "delete", "browserOut", "logout"), events)
		assertEquals(Config.StorageIssue.SAVE_FAILED.description, model.error)
	}

	// Making the browser session renews the login's access, which revokes the access token
	// the login came with.
	@Test
	fun theLoginTheBrowserSignInRenewedIsTheOneKept() = runTest {
		val renewed = session.copy(accessToken = "renewed")
		browserResult = { renewed }
		val model = loadedModel()
		model.password.setTextAndPlaceCursorAtEnd("hunter2")
		var signedIn: Umbreld.Session? = null

		assertTrue(model.connect { s, _ -> signedIn = s })

		assertEquals(listOf(renewed), stored)
		assertEquals(renewed, signedIn)
	}

	@Test
	fun theBrowserSignsInWithTheSameAccountPasswordAndCode() = runTest {
		accounts = listOf(owner, member)
		val model = model()
		model.loadAccounts {}
		model.selectAccount(member)
		model.password.setTextAndPlaceCursorAtEnd("hunter2")
		loginResult = { throw Umbreld.Error(401, "Missing 2FA code") }
		model.connect { _, _ -> }
		loginResult = { session.copy(accountId = "7") }
		model.twoFactorCode.setTextAndPlaceCursorAtEnd("123456")

		assertTrue(model.connect { _, _ -> events += "persist" })

		assertEquals(listOf(Triple("7", "hunter2", "123456")), browserLogins)
		assertEquals(listOf("browserIn", "store", "persist"), events)
	}

	@Test
	fun dismissingDuringLoginKeepsNothing() = runTest {
		val gate = CompletableDeferred<Umbreld.Session>()
		val waiting = SignInModel(
			preferredUserId = null,
			listAccounts = { accounts },
			login = { _, _, _ -> gate.await() },
			storeSession = { events += "store"; true },
			deleteSession = { events += "delete" },
			logout = { events += "logout" },
			browserSignIn = { login, _, _ -> events += "browserIn"; login },
			browserSignOut = { events += "browserOut" },
		)
		waiting.loadAccounts {}
		waiting.password.setTextAndPlaceCursorAtEnd("hunter2")
		val job = launch(start = CoroutineStart.UNDISPATCHED) { waiting.connect { _, _ -> events += "persist" } }
		assertTrue(waiting.loading)
		job.cancel()
		gate.complete(session)
		job.join()
		assertTrue(events.isEmpty())
		assertFalse(waiting.loading)
	}

	@Test
	fun dismissingAsTheLoginReturnsEndsTheNewSession() = runTest {
		// The sheet closes in the same instant the server answers.
		val cancelling = SignInModel(
			preferredUserId = null,
			listAccounts = { accounts },
			login = { _, _, _ ->
				currentCoroutineContext().job.cancel()
				session
			},
			storeSession = { events += "store"; true },
			deleteSession = { events += "delete" },
			logout = { events += "logout" },
			browserSignIn = { login, _, _ -> events += "browserIn"; login },
			browserSignOut = { events += "browserOut" },
		)
		cancelling.loadAccounts {}
		cancelling.password.setTextAndPlaceCursorAtEnd("hunter2")
		launch { cancelling.connect { _, _ -> events += "persist" } }.join()
		assertEquals(listOf("logout"), events)
	}

	@Test
	fun dismissingDuringTheBrowserSignInEndsBothSessions() = runTest {
		val gate = CompletableDeferred<Unit>()
		val waiting = SignInModel(
			preferredUserId = null,
			listAccounts = { accounts },
			login = { _, _, _ -> session },
			storeSession = { events += "store"; true },
			deleteSession = { events += "delete" },
			logout = { events += "logout" },
			browserSignIn = { login, _, _ ->
				events += "browserIn"
				gate.await()
				login
			},
			browserSignOut = { events += "browserOut" },
		)
		waiting.loadAccounts {}
		waiting.password.setTextAndPlaceCursorAtEnd("hunter2")
		val job = launch(start = CoroutineStart.UNDISPATCHED) { waiting.connect { _, _ -> events += "persist" } }
		job.cancel()
		gate.complete(Unit)
		job.join()
		assertEquals(listOf("browserIn", "browserOut", "logout"), events)
	}

	@Test
	fun switchingAccountsClearsCredentialsAndLeavesTwoFactor() = runTest {
		accounts = listOf(owner, member)
		val model = model()
		model.loadAccounts {}
		model.password.setTextAndPlaceCursorAtEnd("hunter2")
		loginResult = { throw Umbreld.Error(401, "Missing 2FA code") }
		model.connect { _, _ -> }
		model.twoFactorCode.setTextAndPlaceCursorAtEnd("12")

		model.selectAccount(owner)
		assertEquals(SignInStep.TWO_FACTOR, model.step)

		model.selectAccount(member)
		assertEquals(member, model.selectedAccount)
		assertEquals(SignInStep.PASSWORD, model.step)
		assertEquals("", model.password.text.toString())
		assertEquals("", model.twoFactorCode.text.toString())
		assertNull(model.error)
	}

	// ── Setup ──

	@Test
	fun aNewUmbrelIsSetUpInTheAppUnlessItsDrivesMeanRaid() = runTest {
		val drive = { id: String?, system: Boolean? -> Umbreld.InternalStorageDevice(id, system) }
		assertEquals(SignInStep.SETUP, SignInModel.setupStep("Umbrel Home") { error("not asked") })
		assertEquals(SignInStep.SETUP, SignInModel.setupStep("Raspberry Pi 5") { error("not asked") })
		assertEquals(SignInStep.BROWSER_SETUP, SignInModel.setupStep("Umbrel Pro") { error("not asked") })
		assertEquals(SignInStep.SETUP, SignInModel.setupStep("Umbrel") { listOf(drive("nvme-system", true)) })
		assertEquals(SignInStep.BROWSER_SETUP, SignInModel.setupStep("Umbrel") { listOf(drive("nvme-system", true), drive("ata-disk", null)) })
		// If the drives can't be checked, the browser is the safe choice.
		assertEquals(SignInStep.BROWSER_SETUP, SignInModel.setupStep("Umbrel") { throw IOException("offline") })
		// ASUS NUCs are PCs, as in umbrelOS: their drives decide.
		assertEquals(SignInStep.SETUP, SignInModel.setupStep("ASUS NUC 16 Pro") { listOf(drive("nvme-system", true)) })
		assertEquals(SignInStep.BROWSER_SETUP, SignInModel.setupStep("ASUS ROG NUC 16") { listOf(drive("nvme-system", true), drive("ata-disk", null)) })
	}

	@Test
	fun finishingSetupSignsInWithTheChosenPassword() = runTest {
		accounts = emptyList()
		val model = model()
		model.loadAccounts {}
		model.startSetup()
		assertTrue(model.settingUp)
		accounts = listOf(owner)

		model.setupFinished("chosen-password")
		assertTrue(model.finishSetup {})

		assertFalse(model.settingUp)
		assertEquals(SignInStep.PASSWORD, model.step)
		assertEquals("chosen-password", model.password.text.toString())
		assertEquals(1, model.autoConnectRequests)
	}

	@Test
	fun setupLeftWithoutAnAccountReturnsToSetUp() = runTest {
		accounts = emptyList()
		val model = model()
		model.loadAccounts {}
		model.startSetup()

		model.setupCancelled()
		assertTrue(model.finishSetup {})

		assertEquals(SignInStep.SETUP, model.step)
		assertEquals(0, model.autoConnectRequests)
	}

	@Test
	fun aRestartingStepHandsSetupToABrowserAndBackReturnsToTheApp() = runTest {
		accounts = emptyList()
		val model = model()
		model.loadAccounts {}
		model.startSetup()

		model.setupNeedsBrowser(restoring = true)
		assertTrue(model.finishSetup {})
		assertEquals(SignInStep.BROWSER_SETUP, model.step)
		assertEquals(SetupHandoff.RESTORE, model.handoff)
		// Coming back from the browser with still no account keeps the handoff.
		assertTrue(model.loadAccounts {})
		assertEquals(SignInStep.BROWSER_SETUP, model.step)

		model.returnToSetup()
		assertNull(model.handoff)
		assertTrue(model.settingUp)
		assertEquals(SignInStep.SETUP, model.step)
	}

	@Test
	fun anUmbrelThatCantBeReachedAfterBrowserSetupClosesTheSheet() = runTest {
		accounts = emptyList()
		val model = model()
		model.loadAccounts {}
		model.startSetup()
		model.setupNeedsBrowser(restoring = false)
		model.finishSetup {}

		// RAID setup or a restore gave the Umbrel a new identity this sheet can't reach.
		assertFalse(model.loadAccounts { throw IOException("new identity") })
	}

	@Test
	fun anIdentityChangeIsNotRecognizedAndOtherFailuresOfferRetry() = runTest {
		val model = SignInModel(
			preferredUserId = null,
			listAccounts = { accounts },
			login = { _, _, _ -> session },
			storeSession = { true },
			deleteSession = {},
			logout = {},
			browserSignIn = { login, _, _ -> login },
			browserSignOut = {},
			isIdentityChange = { it.message == "changed" },
		)
		assertTrue(model.loadAccounts { throw IOException("changed") })
		assertEquals(SignInStep.NOT_RECOGNIZED, model.step)
		assertTrue(model.loadAccounts { throw IOException("offline") })
		assertEquals(SignInStep.LOAD_FAILED, model.step)
	}

	@Test
	fun twoFactorKeepsTheFirstSixDigits() {
		assertEquals("123456", twoFactorDigits("123 456"))
		assertEquals("123456", twoFactorDigits("12a3-45678"))
		assertEquals("", twoFactorDigits("abc"))
		// Only ASCII digits: other scripts' digits are not part of a TOTP code.
		assertEquals("12", twoFactorDigits("1٣2"))
	}

	private suspend fun loadedModel(): SignInModel = model().also { it.loadAccounts {} }
}

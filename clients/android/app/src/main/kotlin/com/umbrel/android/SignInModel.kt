package com.umbrel.android

import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.foundation.text.input.setTextAndPlaceCursorAtEnd
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.umbrel.android.browser.BrowserSessions
import com.umbrel.kit.SecretStore
import com.umbrel.kit.UmbrelDeviceKind
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext

internal enum class SignInStep { LOADING_ACCOUNTS, SETUP, BROWSER_SETUP, NOT_RECOGNIZED, LOAD_FAILED, PASSWORD, TWO_FACTOR }

/** Why setup that began in the app has to finish in a browser. */
internal enum class SetupHandoff { RESTORE, SETUP }

internal class SessionStorageException : Exception("Couldn’t save your session. Please try again.")

/** Only the first six ASCII digits survive, so typing, autofill and paste all land the same. */
internal fun twoFactorDigits(input: CharSequence): String =
	input.filter { it in '0'..'9' }.take(6).toString()

/**
 * The sign-in sheet's state and actions. Sign-in also signs the in-app browser in, then
 * stores the session before the caller persists the device;
 * if either step fails, both sessions are deleted and logged out server-side so the app
 * never claims a login that won't survive relaunch.
 */
@Stable
internal class SignInModel(
	private val preferredUserId: String?,
	private val listAccounts: suspend () -> List<Umbreld.Account>,
	private val login: suspend (userId: String, password: String, totpToken: String?) -> Umbreld.Session,
	private val storeSession: suspend (Umbreld.Session) -> Boolean,
	private val deleteSession: suspend () -> Unit,
	private val logout: suspend (Umbreld.Session) -> Unit,
	/** Returns the sign-in to store: making the browser session renews its access. */
	private val browserSignIn: suspend (session: Umbreld.Session, password: String, totpToken: String?) -> Umbreld.Session,
	private val browserSignOut: suspend (userId: String) -> Unit,
	/** Where a new Umbrel is set up: in the app, or in a browser. */
	private val setupStep: suspend () -> SignInStep = { SignInStep.SETUP },
	/** Whether a failure to load means the Umbrel answered as a different one. */
	private val isIdentityChange: suspend (Exception) -> Boolean = { false },
) {
	var step by mutableStateOf(SignInStep.LOADING_ACCOUNTS)
		private set
	var accounts by mutableStateOf(emptyList<Umbreld.Account>())
		private set
	var selectedAccount by mutableStateOf<Umbreld.Account?>(null)
		private set
	val password = TextFieldState()
	val twoFactorCode = TextFieldState()
	var loading by mutableStateOf(false)
		private set
	var error by mutableStateOf<String?>(null)
		private set

	/** Incremented when a load should move focus to the password field. */
	var passwordFocusRequests by mutableIntStateOf(0)
		private set

	/** Incremented when setup chose a password the sheet should sign in with straight away. */
	var autoConnectRequests by mutableIntStateOf(0)
		private set

	/** Whether umbrelOS's own setup is open in the app. */
	var settingUp by mutableStateOf(false)
		private set

	/** Set when in-app setup reached a step that has to happen in a browser. */
	var handoff by mutableStateOf<SetupHandoff?>(null)
		private set

	// The password chosen during in-app setup, held only until the sheet signs in with it.
	private var setupPassword: String? = null

	val hasMultipleAccounts: Boolean get() = accounts.size > 1

	val connectDisabled: Boolean
		get() = loading || password.text.isEmpty() || (step == SignInStep.TWO_FACTOR && twoFactorCode.text.length != 6)

	/** Returns false when the sheet should close: the Umbrel it was for is gone. */
	suspend fun loadAccounts(prepare: suspend () -> Unit): Boolean {
		val returningFromBrowser = step == SignInStep.BROWSER_SETUP
		step = SignInStep.LOADING_ACCOUNTS
		val loaded = try {
			prepare()
			listAccounts()
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (failure: Exception) {
			// Setting up drives or restoring a backup in a browser gives the Umbrel a new
			// identity, which this sheet can't reach. Going back finds it again as it is now.
			if (returningFromBrowser) return false
			step = if (isIdentityChange(failure)) SignInStep.NOT_RECOGNIZED else SignInStep.LOAD_FAILED
			return true
		}
		accounts = loaded
		if (loaded.isEmpty()) {
			step = if (handoff != null) SignInStep.BROWSER_SETUP else setupStep()
			return true
		}
		handoff = null
		selectedAccount = loaded.firstOrNull { it.userId == preferredUserId }
			?: loaded.firstOrNull { it.userId == "0" }
			?: loaded.first()
		step = SignInStep.PASSWORD
		if (!hasMultipleAccounts) passwordFocusRequests++
		return true
	}

	// ── Setup ──

	/** Opens umbrelOS's own setup in the app. */
	fun startSetup() {
		setupPassword = null
		settingUp = true
	}

	/** Setup produced an account, with the password chosen if the app saw it typed. */
	fun setupFinished(password: String?) {
		setupPassword = password
		settingUp = false
	}

	/** Setup reached a step that restarts the Umbrel, which has to happen in a browser. */
	fun setupNeedsBrowser(restoring: Boolean) {
		handoff = if (restoring) SetupHandoff.RESTORE else SetupHandoff.SETUP
		step = SignInStep.BROWSER_SETUP
		settingUp = false
	}

	fun setupCancelled() {
		settingUp = false
	}

	/** From the browser handoff, back to setting up in the app. */
	fun returnToSetup() {
		handoff = null
		setupPassword = null
		step = SignInStep.SETUP
		settingUp = true
	}

	/**
	 * Setup ended, finished or not. If an account now exists, sign in with the password that
	 * was just chosen; otherwise the sheet is back where it started. Returns false when the
	 * sheet should close.
	 */
	suspend fun finishSetup(prepare: suspend () -> Unit): Boolean {
		val chosenPassword = setupPassword
		setupPassword = null
		if (handoff != null) {
			step = SignInStep.BROWSER_SETUP
			return true
		}
		if (!loadAccounts(prepare)) return false
		if (step == SignInStep.PASSWORD && !chosenPassword.isNullOrEmpty()) {
			password.setTextAndPlaceCursorAtEnd(chosenPassword)
			autoConnectRequests++
		}
		return true
	}

	fun selectAccount(account: Umbreld.Account) {
		if (selectedAccount?.userId == account.userId) return
		selectedAccount = account
		password.clearText()
		twoFactorCode.clearText()
		error = null
		step = SignInStep.PASSWORD
	}

	/** Returns true once the code is complete, which submits it. */
	fun twoFactorCodeChanged(code: CharSequence): Boolean {
		if (error != null && code.isNotEmpty()) error = null
		return code.length == 6
	}

	/** Returns true once the caller has persisted the sign-in. */
	suspend fun connect(onSignedIn: (Umbreld.Session, Umbreld.Account?) -> Unit): Boolean {
		if (connectDisabled) return false
		val account = selectedAccount
		val userId = account?.userId ?: "0"
		val submittedPassword = password.text.toString()
		val submittedCode = if (step == SignInStep.TWO_FACTOR) twoFactorCode.text.toString() else null
		loading = true
		error = null
		val caller = currentCoroutineContext().job
		try {
			val login = login(userId, submittedPassword, submittedCode)
			// Past this point the login exists on the server, so it is either kept or rolled
			// back, including when the sheet closes meanwhile.
			withContext(NonCancellable) {
				if (!caller.isActive) {
					logOutQuietly(login)
					throw CancellationException("Sign-in was dismissed")
				}
				// Best effort: without it umbrelOS shows its own login page once.
				val session = browserSignIn(login, submittedPassword, submittedCode)
				if (!caller.isActive) {
					browserSignOut(userId)
					logOutQuietly(session)
					throw CancellationException("Sign-in was dismissed")
				}
				persist(session, account, onSignedIn)
			}
			return true
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (failure: Umbreld.Error) {
			if (failure.requiresTwoFactorAuthentication) {
				step = SignInStep.TWO_FACTOR
				twoFactorCode.clearText()
			} else {
				fail(failure)
			}
		} catch (failure: Exception) {
			fail(failure)
		} finally {
			loading = false
		}
		return false
	}

	private fun fail(failure: Exception) {
		error = failure.message ?: "Couldn’t sign in."
		if (step == SignInStep.TWO_FACTOR) twoFactorCode.clearText()
	}

	private suspend fun persist(
		session: Umbreld.Session,
		account: Umbreld.Account?,
		onSignedIn: (Umbreld.Session, Umbreld.Account?) -> Unit,
	) {
		if (!storeSession(session)) {
			browserSignOut(session.accountId)
			logOutQuietly(session)
			throw SessionStorageException()
		}
		try {
			onSignedIn(session, account)
		} catch (failure: Exception) {
			deleteSession()
			browserSignOut(session.accountId)
			logOutQuietly(session)
			throw failure
		}
	}

	private suspend fun logOutQuietly(session: Umbreld.Session) {
		try {
			logout(session)
		} catch (cancellation: CancellationException) {
			throw cancellation
		} catch (failure: Exception) {
			// Best effort: the local session is already gone, and the server expires it.
		}
	}

	companion object {
		/** Keystore and file writes run on the IO dispatcher so the sheet stays main-safe. */
		fun forDevice(deviceId: String, model: String?, target: () -> Umbreld.Target, preferredUserId: String?) = SignInModel(
			preferredUserId = preferredUserId,
			listAccounts = { Umbreld.listAccounts(target()) },
			login = { userId, password, totpToken -> Umbreld.login(target(), userId, password, totpToken) },
			storeSession = { session -> withContext(Dispatchers.IO) { SecretStore.setSession(session, deviceId) } },
			deleteSession = { withContext(Dispatchers.IO) { SecretStore.deleteSession(deviceId) } },
			logout = { session -> Umbreld.logout(target(), session) },
			// Both are best effort: a browser that can't sign in shows umbrelOS's login page once,
			// and nothing about the browser may stop the native sign-in or its rollback.
			browserSignIn = { session, password, totpToken ->
				bestEffort(session) { BrowserSessions.signIn(target(), session, password, totpToken) }
			},
			browserSignOut = { userId -> bestEffort(Unit) { BrowserSessions.signOut(target(), userId) } },
			setupStep = { setupStep(model) { Umbreld.internalStorageDevices(target()) } },
			isIdentityChange = { failure ->
				// A certificate the pin refuses counts only once the Umbrel proves it's the same
				// one with a new certificate.
				Umbreld.isIdentityChange(failure) ||
					(failure is Umbreld.Error && failure.kind == Umbreld.ErrorKind.TRUST && Umbreld.identityChanged(target()))
			},
		)

		private suspend fun <T> bestEffort(fallback: T, block: suspend () -> T): T =
			try {
				block()
			} catch (cancellation: CancellationException) {
				throw cancellation
			} catch (failure: Exception) {
				fallback
			}

		/**
		 * Decided before setup starts, so nobody begins in the app and gets sent to a browser
		 * halfway. umbrelOS sets up RAID on an Umbrel Pro, and on a PC with a drive it could
		 * use; that restarts the Umbrel with a new identity the app can't follow. If the drives
		 * can't be checked, the browser is the safe choice.
		 */
		internal suspend fun setupStep(model: String?, drives: suspend () -> List<Umbreld.InternalStorageDevice>): SignInStep = when (UmbrelDeviceKind.fromModel(model)) {
			UmbrelDeviceKind.HOME, UmbrelDeviceKind.RASPBERRY_PI -> SignInStep.SETUP
			UmbrelDeviceKind.PRO -> SignInStep.BROWSER_SETUP
			UmbrelDeviceKind.ASUS_NUC_14_ESSENTIAL, UmbrelDeviceKind.ASUS_NUC_16_PRO, UmbrelDeviceKind.ASUS_ROG_NUC_16, UmbrelDeviceKind.GENERIC -> {
				val devices = try {
					drives()
				} catch (cancellation: CancellationException) {
					throw cancellation
				} catch (failure: Exception) {
					null
				}
				if (devices == null || devices.any { it.isRaidCandidate }) SignInStep.BROWSER_SETUP else SignInStep.SETUP
			}
		}
	}
}

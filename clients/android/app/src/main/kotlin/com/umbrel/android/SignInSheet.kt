package com.umbrel.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicSecureTextField
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalAutofillManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.umbrel.android.browser.SetupBrowser
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.interFor
import com.umbrel.android.ui.isAccessibilityTextSize
import com.umbrel.android.ui.openUrl
import com.umbrel.kit.Config
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

private val SheetBackground = Color(0xFF1C1C1E)
private val FieldGroup = Color(0xFF2C2C2E)
private val Label = Color(0xFF8E8E93)
private val ConnectIndigo = Color(0xFF6155F5)

// iOS 26's dark-mode system colours: red for errors, blue for the text cursor.
private val SystemRed = Color(0xFFFF4245)
private val SystemBlue = Color(0xFF0091FF)
private val Grabber = Color(0xFF616166)

// Apple's default text styles. Letter spacing is zeroed so Material's body tracking doesn't apply.
private val Headline = TextStyle(fontFamily = interFor(17.sp), fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp)
private val Title3 = TextStyle(fontFamily = interFor(20.sp), fontSize = 20.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp)
private val Subheadline = TextStyle(fontFamily = interFor(15.sp), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.sp)
private val Footnote = TextStyle(fontFamily = interFor(13.sp), fontSize = 13.sp, lineHeight = 18.sp, letterSpacing = 0.sp)

// iOS uses a 540 pt sheet, or the full-height sheet at accessibility text sizes.
private val SheetHeight = 540.dp

// A partial-height iOS 26 sheet floats 8 pt inside the screen's sides and bottom.
private val SheetInset = 8.dp
private val SheetCornerRadius = 38.dp

// iOS's 13 pt action padding sits inside the sheet's bottom safe area, which places the
// buttons 16 pt from the sheet's sides.
private val ActionInset = 16.dp

private const val HostKeyboardTimeoutMillis = 1_000L
private const val TwoFactorHint = "2faAppOTPCode"

/**
 * The same sheet serves first-time onboarding and reconnecting a saved Umbrel. Like umbrelOS,
 * multi-user devices keep account selection and credentials in one place; single-user devices
 * keep the compact password-only form.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInSheet(
	deviceId: String,
	deviceName: String,
	deviceModel: String?,
	target: Umbreld.Target,
	preferredUserId: String? = null,
	onPrepare: suspend () -> Unit,
	onSignedIn: (Umbreld.Session, Umbreld.Account?) -> Unit,
	onDismiss: () -> Unit,
	onRemove: (suspend () -> Unit)?,
	// Removes a saved Umbrel the app no longer recognizes and starts adding it again. Without
	// one, "not recognized" goes back to the list, where it can be found again.
	onReconnect: (suspend () -> Unit)? = null,
	// Its Umbrel is being removed. The sheet stays as it is until it's gone, as on iOS, but
	// nothing in it acts meanwhile.
	removing: Boolean = false,
) {
	// Material's sheet sets its resting position from the window height above the keyboard.
	// If the screen underneath is still closing its keyboard, that height changes under the
	// show animation and can strand the sheet off screen, so the sheet waits for it to close.
	val focusManager = LocalFocusManager.current
	val density = LocalDensity.current
	val hostKeyboard = WindowInsets.ime
	var hostKeyboardClosed by remember { mutableStateOf(false) }
	LaunchedEffect(Unit) {
		focusManager.clearFocus()
		withTimeoutOrNull(HostKeyboardTimeoutMillis) {
			snapshotFlow { hostKeyboard.getBottom(density) }.first { it == 0 }
		}
		hostKeyboardClosed = true
	}

	// Requests use the target as it is when they start, so a saved device whose address
	// changes while the sheet is open is retried at its new address.
	val currentTarget by rememberUpdatedState(target)
	val model = remember(deviceId) { SignInModel.forDevice(deviceId, deviceModel, { currentTarget }, preferredUserId) }
	val scope = rememberCoroutineScope()
	val currentOnPrepare by rememberUpdatedState(onPrepare)
	val currentOnDismiss by rememberUpdatedState(onDismiss)
	var loadJob by remember { mutableStateOf<Job?>(null) }
	fun loadAccounts() {
		loadJob?.cancel()
		loadJob = scope.launch { if (!model.loadAccounts { currentOnPrepare() }) currentOnDismiss() }
	}
	// Setup ended, finished or not: sign in with the password just chosen, if there's an account.
	fun finishSetup() {
		loadJob?.cancel()
		loadJob = scope.launch { if (!model.finishSetup { currentOnPrepare() }) currentOnDismiss() }
	}
	LaunchedEffect(model) { loadAccounts() }
	// Returning from a browser is the signal to re-read the account list.
	LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
		if (model.step == SignInStep.BROWSER_SETUP || (model.step == SignInStep.SETUP && !model.settingUp)) loadAccounts()
	}
	if (model.settingUp) {
		SetupBrowser(
			target = target,
			onFinish = { password ->
				model.setupFinished(password)
				finishSetup()
			},
			onNeedsBrowser = { restoring ->
				model.setupNeedsBrowser(restoring)
				finishSetup()
			},
			onCancel = {
				model.setupCancelled()
				finishSetup()
			},
		)
	}

	if (!hostKeyboardClosed) return

	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	val accessibilitySize = isAccessibilityTextSize()
	ModalBottomSheet(
		onDismissRequest = onDismiss,
		modifier = if (accessibilitySize) Modifier else Modifier.padding(start = SheetInset, end = SheetInset, bottom = SheetInset),
		sheetState = sheetState,
		shape = if (accessibilitySize) {
			RoundedCornerShape(topStart = SheetCornerRadius, topEnd = SheetCornerRadius)
		} else {
			RoundedCornerShape(SheetCornerRadius)
		},
		containerColor = SheetBackground,
		contentColor = Color.White,
		scrimColor = Color.Black.copy(alpha = 0.48f),
		dragHandle = null,
	) {
		SignInForm(
			model = model,
			title = deviceName,
			target = target,
			accessibilitySize = accessibilitySize,
			awaitShown = { snapshotFlow { sheetState.currentValue }.first { it == SheetValue.Expanded } },
			onRetry = ::loadAccounts,
			onClose = {
				scope.launch { sheetState.hide() }.invokeOnCompletion {
					if (!sheetState.isVisible) onDismiss()
				}
			},
			onSignedIn = onSignedIn,
			onRemove = onRemove,
			onReconnect = onReconnect,
			removing = removing,
		)
	}
}

@Composable
private fun SignInForm(
	model: SignInModel,
	title: String,
	target: Umbreld.Target,
	accessibilitySize: Boolean,
	awaitShown: suspend () -> Unit,
	onRetry: () -> Unit,
	onClose: () -> Unit,
	onSignedIn: (Umbreld.Session, Umbreld.Account?) -> Unit,
	onRemove: (suspend () -> Unit)?,
	onReconnect: (suspend () -> Unit)?,
	removing: Boolean,
) {
	val context = LocalContext.current
	val scope = rememberCoroutineScope()
	val autofill = LocalAutofillManager.current
	val currentOnSignedIn by rememberUpdatedState(onSignedIn)
	val currentRemoving by rememberUpdatedState(removing)
	var signedIn by remember { mutableStateOf(false) }
	var confirmingRemoval by remember { mutableStateOf(false) }
	var confirmingReconnect by remember { mutableStateOf(false) }
	var reconnecting by remember { mutableStateOf(false) }
	val browserHost = target.hosts.firstOrNull() ?: "umbrel.local"

	// A password that never signed in must not be offered for saving.
	DisposableEffect(autofill) {
		onDispose { if (!signedIn) autofill?.cancel() }
	}

	fun connect() {
		if (model.connectDisabled || currentRemoving) return
		// Undispatched, so a second tap in the same frame already sees the sheet loading.
		scope.launch(start = CoroutineStart.UNDISPATCHED) {
			if (model.connect { session, account -> currentOnSignedIn(session, account) }) {
				signedIn = true
				autofill?.commit()
			}
		}
	}

	// Setup chose the password: sign in with it, so nobody is asked to type it a third time.
	LaunchedEffect(model.autoConnectRequests) {
		if (model.autoConnectRequests > 0) connect()
	}

	val removeButton: @Composable () -> Unit = {
		if (onRemove != null) {
			RemoveButton(enabled = !model.loading) { if (!removing) confirmingRemoval = true }
		}
	}

	Column(Modifier.fillMaxWidth().then(if (accessibilitySize) Modifier.fillMaxHeight() else Modifier.height(SheetHeight))) {
		SheetHeader(title, onClose)
		when (model.step) {
			SignInStep.LOADING_ACCOUNTS -> Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
				Spinner()
			}
			// Android has no local-network permission at this target SDK, so iOS's "Local
			// Network Access Off" state has no counterpart here.
			SignInStep.SETUP -> Message(
				title = "Set up your Umbrel",
				description = "This Umbrel is brand new. Create your account to start using it.",
				actionTitle = "Set Up",
				showsUmbrelMark = true,
				onAction = { if (!removing) model.startSetup() },
				removeButton = removeButton,
			)
			// Restoring a backup or setting up RAID moves the Umbrel onto other drives and
			// restarts it with a new identity (certificate and device ID). The app trusts the
			// identity it paired with, so it can't follow the Umbrel through that restart, and
			// those setups happen in a browser instead. This can go once umbrelOS keeps its
			// identity through the move.
			SignInStep.BROWSER_SETUP -> Message(
				title = if (model.handoff == SetupHandoff.RESTORE) "Restore in a browser" else "Set up your Umbrel",
				description = if (model.handoff == SetupHandoff.RESTORE) {
					"Restoring from a backup happens in a web browser, ideally on a computer. Go to $browserHost and choose Restore, then come back here to sign in."
				} else {
					"Set up your Umbrel in a web browser, ideally on a computer. Go to $browserHost, then come back here to sign in."
				},
				actionTitle = "Open in Browser",
				showsUmbrelMark = true,
				onAction = { context.openUrl("http://$browserHost") },
				secondaryTitle = if (model.handoff != null) "Back" else null,
				onSecondaryAction = model::returnToSetup,
				removeButton = removeButton,
			)
			// Without a saved Umbrel to reconnect (first-time onboarding), going back to the list
			// finds it again as it is now.
			SignInStep.NOT_RECOGNIZED -> Message(
				title = "Umbrel not recognized",
				description = if (onReconnect == null) {
					"Go back and choose your Umbrel again."
				} else {
					"This usually happens after your Umbrel or its certificate is reset. Reconnect your Umbrel to keep using it in this app."
				},
				actionTitle = if (onReconnect == null) "Go Back" else if (reconnecting) "Reconnecting…" else "Reconnect",
				onAction = {
					if (onReconnect == null) onClose() else if (!reconnecting && !removing) confirmingReconnect = true
				},
				removeButton = removeButton,
			)
			SignInStep.LOAD_FAILED -> Message(
				title = "Couldn’t connect",
				description = "Make sure your Umbrel is online and your phone can reach it, then try again.",
				actionTitle = "Try again",
				onAction = onRetry,
				removeButton = removeButton,
			)
			SignInStep.PASSWORD, SignInStep.TWO_FACTOR -> Credentials(
				model = model,
				target = target,
				accessibilitySize = accessibilitySize,
				awaitShown = awaitShown,
				onConnect = ::connect,
				removeButton = removeButton,
			)
		}
	}

	if (confirmingReconnect && onReconnect != null) {
		AlertDialog(
			onDismissRequest = { confirmingReconnect = false },
			title = { Text("Reconnect your Umbrel?") },
			text = { Text("You’ll sign in again. If photo backup is on, you’ll need to turn it back on. Everything on your Umbrel stays as it is.") },
			confirmButton = {
				TextButton(onClick = {
					confirmingReconnect = false
					reconnecting = true
					scope.launch {
						try {
							onReconnect()
						} finally {
							reconnecting = false
						}
					}
				}) { Text("Reconnect") }
			},
			dismissButton = {
				TextButton(onClick = { confirmingReconnect = false }) { Text("Cancel") }
			},
		)
	}

	if (confirmingRemoval && onRemove != null) {
		AlertDialog(
			onDismissRequest = { confirmingRemoval = false },
			title = { Text("Remove this Umbrel?") },
			text = {
				Text("This removes the saved Umbrel from this phone. Any photo and video backups will remain on your Umbrel. You can add it again at any time.")
			},
			confirmButton = {
				TextButton(onClick = {
					confirmingRemoval = false
					scope.launch {
						try {
							onRemove()
						} catch (cancellation: CancellationException) {
							throw cancellation
						} catch (failure: Config.StorageException) {
							// DeviceStore reports the storage issue; the sheet stays open.
						}
					}
				}) { Text("Remove", color = SystemRed) }
			},
			dismissButton = {
				TextButton(onClick = { confirmingRemoval = false }) { Text("Cancel") }
			},
		)
	}
}

/** The grabber, the close button and the device as an inline title, as in an iOS sheet's navigation bar. */
@Composable
private fun SheetHeader(title: String, onClose: () -> Unit) {
	Box(Modifier.fillMaxWidth().height(68.dp)) {
		Box(
			Modifier
				.align(Alignment.TopCenter)
				.padding(top = 5.dp)
				.size(36.dp, 5.dp)
				.background(Grabber, CircleShape),
		)
		Box(
			Modifier
				.padding(top = 16.dp, start = 68.dp, end = 68.dp)
				.fillMaxWidth()
				.height(44.dp),
			contentAlignment = Alignment.Center,
		) {
			Text(
				title,
				modifier = Modifier.semantics { heading() },
				style = Headline,
				color = Color.White,
				maxLines = 1,
				overflow = TextOverflow.Ellipsis,
			)
		}
		CloseButton(Modifier.padding(start = 16.dp, top = 16.dp), onClose)
	}
}

// iOS 26 draws the toolbar's close button as system glass: a 44 pt circle whose fill matches
// the sheet and whose rim brightens toward the lower-right and upper-left.
private val CloseButtonRim = Brush.sweepGradient(
	0f to Color.White.copy(alpha = 0.10f),
	0.125f to Color.White.copy(alpha = 0.16f),
	0.25f to Color.White.copy(alpha = 0.10f),
	0.375f to Color.White.copy(alpha = 0f),
	0.5f to Color.White.copy(alpha = 0.10f),
	0.625f to Color.White.copy(alpha = 0.16f),
	0.75f to Color.White.copy(alpha = 0.10f),
	0.875f to Color.White.copy(alpha = 0f),
	1f to Color.White.copy(alpha = 0.10f),
)

@Composable
private fun CloseButton(modifier: Modifier, onClick: () -> Unit) {
	Box(
		modifier
			.size(44.dp)
			.clip(CircleShape)
			.border(1.dp, CloseButtonRim, CircleShape)
			.clickable(role = Role.Button, onClick = onClick),
		contentAlignment = Alignment.Center,
	) {
		Icon(Symbols.Close, contentDescription = "Close", tint = Color.White, modifier = Modifier.size(28.dp))
	}
}

@Composable
private fun ColumnScope.Message(
	title: String,
	description: String,
	actionTitle: String,
	showsUmbrelMark: Boolean = false,
	onAction: () -> Unit,
	secondaryTitle: String? = null,
	onSecondaryAction: () -> Unit = {},
	removeButton: @Composable () -> Unit,
) {
	Column(
		Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
		verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
	) {
		if (showsUmbrelMark) {
			Image(
				painterResource(R.drawable.umbrel_mark),
				contentDescription = null,
				modifier = Modifier.padding(bottom = 8.dp).width(52.dp),
			)
		}
		Text(title, style = Title3, color = Color.White, textAlign = TextAlign.Center)
		Text(description, style = Subheadline, color = Label, textAlign = TextAlign.Center)
	}
	Actions {
		ActionButton(actionTitle, onClick = onAction)
		if (secondaryTitle != null) TextAction(secondaryTitle, onSecondaryAction)
		removeButton()
	}
}

@Composable
private fun ColumnScope.Credentials(
	model: SignInModel,
	target: Umbreld.Target,
	accessibilitySize: Boolean,
	awaitShown: suspend () -> Unit,
	onConnect: () -> Unit,
	removeButton: @Composable () -> Unit,
) {
	val twoFactor = model.step == SignInStep.TWO_FACTOR
	val multiple = model.hasMultipleAccounts
	Column(Modifier.weight(1f).fillMaxWidth()) {
		if (multiple) {
			AccountPicker(
				accounts = model.accounts,
				target = target,
				selectedUserId = model.selectedAccount?.userId,
				enabled = !model.loading,
				onSelectionChange = model::selectAccount,
				modifier = Modifier.padding(top = 4.dp).height(if (accessibilitySize) 224.dp else 196.dp),
			)
		}
		Column(
			Modifier
				.fillMaxWidth()
				.padding(horizontal = 20.dp)
				.padding(top = if (multiple) 24.dp else 20.dp),
			verticalArrangement = Arrangement.spacedBy(16.dp),
		) {
			if (!multiple || twoFactor) {
				val prompt = when {
					twoFactor -> "Enter the code from your authenticator app"
					else -> "Log in to your Umbrel"
				}
				Text(prompt, style = Subheadline, color = Label)
			}
			if (twoFactor) {
				TwoFactorField(model, onConnect)
			} else {
				PasswordField(model, awaitShown, onConnect)
			}
			model.error?.let { error ->
				Text(
					error,
					modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
					style = Footnote,
					color = SystemRed,
				)
			}
		}
		Spacer(Modifier.height(20.dp))
	}
	Actions {
		ActionButton("Sign in", enabled = !model.connectDisabled, busy = model.loading, onClick = onConnect)
		removeButton()
	}
}

@Composable
private fun PasswordField(model: SignInModel, awaitShown: suspend () -> Unit, onConnect: () -> Unit) {
	val focusRequester = remember { FocusRequester() }
	// Focus waits for the sheet to finish rising: the keyboard moves the sheet, and moving it
	// mid-animation is what can strand it.
	LaunchedEffect(model.passwordFocusRequests) {
		if (model.passwordFocusRequests == 0) return@LaunchedEffect
		awaitShown()
		focusRequester.requestFocus()
	}
	// BasicSecureTextField declares ContentType.Password itself, which is what autofill reads.
	BasicSecureTextField(
		state = model.password,
		modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
		enabled = !model.loading,
		textStyle = Subheadline.copy(color = Color.White.copy(alpha = 0.9f), textAlign = TextAlign.End),
		keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
		onKeyboardAction = { onConnect() },
		cursorBrush = SolidColor(SystemBlue),
		// The label is part of the field, so a tap anywhere focuses it and TalkBack reads it.
		decorator = { innerTextField ->
			Row(
				Modifier
					.fillMaxWidth()
					.heightIn(min = 50.dp)
					.background(FieldGroup, RoundedCornerShape(20.dp))
					.padding(12.dp),
				verticalAlignment = Alignment.CenterVertically,
			) {
				Text("Password", style = Subheadline, color = Label)
				Spacer(Modifier.width(8.dp))
				// The field takes the whole remaining width, so the cursor starts at the trailing
				// edge like iOS's trailing-aligned field rather than right after the label.
				Box(Modifier.weight(1f), propagateMinConstraints = true) { innerTextField() }
			}
		},
	)
}

// The code field is an invisible text field under six slots that render it.
private val HiddenSelection = TextSelectionColors(handleColor = Color.Transparent, backgroundColor = Color.Transparent)

private val TwoFactorDigitsOnly = InputTransformation {
	val digits = twoFactorDigits(asCharSequence())
	if (digits != asCharSequence().toString()) replace(0, length, digits)
}

@Composable
private fun TwoFactorField(model: SignInModel, onConnect: () -> Unit) {
	val focusRequester = remember { FocusRequester() }
	val interactionSource = remember { MutableInteractionSource() }
	val focused by interactionSource.collectIsFocusedAsState()
	val enabled = !model.loading
	val currentOnConnect by rememberUpdatedState(onConnect)
	// Focus on appearing and again after a failed attempt re-enables the field.
	LaunchedEffect(enabled) {
		if (enabled) focusRequester.requestFocus()
	}
	LaunchedEffect(model.twoFactorCode) {
		snapshotFlow { model.twoFactorCode.text.toString() }.collect { code ->
			if (model.twoFactorCodeChanged(code)) currentOnConnect()
		}
	}
	val code = model.twoFactorCode.text
	val hasError = model.error != null
	CompositionLocalProvider(LocalTextSelectionColors provides HiddenSelection) {
		Box(
			Modifier
				.fillMaxWidth()
				.pointerInput(Unit) { detectTapGestures { focusRequester.requestFocus() } },
			contentAlignment = Alignment.Center,
		) {
			BasicTextField(
				state = model.twoFactorCode,
				modifier = Modifier
					.size(268.dp, 50.dp)
					.focusRequester(focusRequester)
					.semantics {
						contentDescription = "Verification code"
						contentType = ContentType(TwoFactorHint)
					},
				enabled = enabled,
				inputTransformation = TwoFactorDigitsOnly,
				textStyle = TextStyle(color = Color.Transparent),
				keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Go),
				onKeyboardAction = { onConnect() },
				lineLimits = TextFieldLineLimits.SingleLine,
				interactionSource = interactionSource,
				cursorBrush = SolidColor(Color.Transparent),
				decorator = { innerTextField ->
					Box(contentAlignment = Alignment.Center) {
						Box(Modifier.fillMaxSize()) { innerTextField() }
						// A fixed-size rendering of the field above, so the slots don't scale with text size.
						Row(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
							val activeIndex = minOf(code.length, 5)
							repeat(6) { index ->
								TwoFactorSlot(
									digit = code.getOrNull(index)?.toString() ?: "",
									border = when {
										hasError -> SystemRed
										focused && index == activeIndex -> Color.White.copy(alpha = 0.4f)
										else -> Color.White.copy(alpha = 0.1f)
									},
								)
							}
						}
					}
				},
			)
		}
	}
}

@Composable
private fun TwoFactorSlot(digit: String, border: Color) {
	val shape = RoundedCornerShape(12.dp)
	Box(
		Modifier
			.size(38.dp, 50.dp)
			.background(FieldGroup, shape)
			.border(1.dp, border, shape),
		contentAlignment = Alignment.Center,
	) {
		Text(
			digit,
			style = TextStyle(
				fontFamily = FontFamily.Monospace,
				fontWeight = FontWeight.SemiBold,
				fontSize = with(LocalDensity.current) { 18.dp.toSp() },
			),
			color = Color.White.copy(alpha = 0.9f),
		)
	}
}

@Composable
private fun Actions(content: @Composable () -> Unit) {
	Column(
		Modifier.fillMaxWidth().padding(horizontal = ActionInset).padding(bottom = 12.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
		verticalArrangement = Arrangement.spacedBy(4.dp),
	) { content() }
}

/** The indigo pill. Disabled buttons draw at half opacity, fill and label together, as on iOS. */
@Composable
private fun ActionButton(title: String, enabled: Boolean = true, busy: Boolean = false, onClick: () -> Unit) {
	Box(
		Modifier
			.fillMaxWidth()
			.heightIn(min = 48.dp)
			.alpha(if (enabled) 1f else 0.5f)
			.clip(CircleShape)
			.background(ConnectIndigo)
			.clickable(enabled = enabled, role = Role.Button, onClick = onClick),
		contentAlignment = Alignment.Center,
	) {
		// The title stays laid out under the spinner so the button keeps its size and its label.
		Text(title, modifier = Modifier.alpha(if (busy) 0f else 1f), style = Headline, color = Color.White)
		if (busy) Spinner()
	}
}

@Composable
private fun TextAction(title: String, onClick: () -> Unit) {
	Box(
		Modifier
			.heightIn(min = 40.dp)
			.clip(CircleShape)
			.clickable(role = Role.Button, onClick = onClick)
			.padding(horizontal = 12.dp),
		contentAlignment = Alignment.Center,
	) {
		Text(title, style = Footnote.copy(fontWeight = FontWeight.SemiBold), color = Label)
	}
}

@Composable
private fun RemoveButton(enabled: Boolean, onClick: () -> Unit) {
	Box(
		Modifier
			.heightIn(min = 40.dp)
			.alpha(if (enabled) 1f else 0.5f)
			.clip(CircleShape)
			.clickable(enabled = enabled, role = Role.Button, onClick = onClick)
			.padding(horizontal = 12.dp),
		contentAlignment = Alignment.Center,
	) {
		Text("Remove from this phone", style = Footnote.copy(fontWeight = FontWeight.SemiBold), color = Label)
	}
}

@Composable
private fun Spinner(size: Dp = 20.dp) {
	CircularProgressIndicator(Modifier.size(size), color = Color.White, strokeWidth = 2.dp)
}

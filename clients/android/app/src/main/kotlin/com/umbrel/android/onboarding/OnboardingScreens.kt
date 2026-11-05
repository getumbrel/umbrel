package com.umbrel.android.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.rememberViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.umbrel.android.R
import com.umbrel.android.SignInSheet
import com.umbrel.android.container
import com.umbrel.android.ui.Palette
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.glassGlint
import com.umbrel.android.ui.CircleIconButton
import com.umbrel.android.ui.interFor
import com.umbrel.android.ui.openUrl
import com.umbrel.kit.IdentifiedDevice
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The onboarding flow, a screen-for-screen port of the iOS OnboardingFlow. Steps push
 * through a fixed background; the background never transitions except to turn red for
 * "No device found".
 */
@Composable
fun OnboardingFlow(mode: OnboardingMode, onFinished: (String) -> Unit, onCancel: () -> Unit) {
	val context = LocalContext.current
	// A fresh model each time the flow opens, as on iOS. It survives rotation and is cleared,
	// stopping discovery, when the flow closes.
	val owner = rememberViewModelStoreOwner()
	val model: OnboardingViewModel = viewModel(viewModelStoreOwner = owner) { OnboardingViewModel(context, mode) }
	val state by model.state.collectAsStateWithLifecycle()
	val push = with(LocalDensity.current) { 28.dp.roundToPx() }

	// System back follows the on-screen Back and Cancel controls.
	BackHandler(enabled = mode == OnboardingMode.ADD_DEVICE && state.step != OnboardingStep.CONNECTED, onBack = onCancel)
	BackHandler(enabled = state.step == OnboardingStep.MANUAL_ADDRESS, onBack = model::closeManualAddress)

	Box(Modifier.fillMaxSize()) {
		Crossfade(state.step == OnboardingStep.NO_DEVICE, animationSpec = tween(400, easing = EaseOut), label = "background") { noDevice ->
			if (noDevice) OnboardingBackground(tint = Palette.error, secondaryTint = Palette.error) else OnboardingBackground()
		}
		AnimatedContent(
			targetState = state.step,
			// Sign-in opens a sheet over the device-found screen without changing the screen.
			contentKey = { if (it == OnboardingStep.SIGN_IN) OnboardingStep.DEVICE_FOUND else it },
			transitionSpec = {
				val forward = state.movingForward
				val offset = tween<IntOffset>(400, easing = EaseOut)
				val fade = tween<Float>(400, easing = EaseOut)
				(fadeIn(fade) + slideInHorizontally(offset) { if (forward) push else -push }) togetherWith
					(fadeOut(fade) + slideOutHorizontally(offset) { if (forward) -push else push }) using
					SizeTransform(clip = false)
			},
			label = "onboarding",
		) { step ->
			when (step) {
				OnboardingStep.SPLASH -> SplashScreen()
				OnboardingStep.WELCOME -> WelcomeScreen { model.advance(OnboardingStep.FINDING) }
				OnboardingStep.FINDING -> FindingScreen()
				OnboardingStep.NO_DEVICE -> NoDeviceScreen(onScanAgain = model::scanAgain, onManual = model::openManualAddress)
				OnboardingStep.DEVICE_FOUND, OnboardingStep.SIGN_IN -> DeviceFoundScreen(
					state,
					onConnect = model::selectDevice,
					onRetry = model::retry,
					onManual = model::openManualAddress,
				)
				OnboardingStep.MANUAL_ADDRESS -> ManualAddressScreen(
					savedIds = state.savedIds,
					signingIn = state.selectedDevice != null,
					discover = model::discoverManually,
					onBack = model::closeManualAddress,
					onFound = model::manualDeviceFound,
				)
				OnboardingStep.CONNECTED -> ConnectedScreen(state.selectedDevice) {
					model.finish()?.let(onFinished) ?: onCancel()
				}
			}
		}
		// Adding a device is escapable at every step; first-run onboarding has no way out
		// until a device is connected.
		if (mode == OnboardingMode.ADD_DEVICE && state.step != OnboardingStep.CONNECTED) {
			Box(Modifier.align(Alignment.TopEnd).systemBarsPadding().padding(end = 20.dp)) {
				CircleIconButton(Symbols.CloseMedium, contentDescription = "Cancel", iconSize = 24.dp, onClick = onCancel)
			}
		}
	}

	val selected = state.selectedDevice
	// A device found by address signs in over the address screen, so dismissing returns there.
	if ((state.step == OnboardingStep.SIGN_IN || state.step == OnboardingStep.MANUAL_ADDRESS) && selected != null) {
		// Claiming the Umbrel's HTTPS identity is a first-use trust decision, made once per sheet:
		// retrying the account list reuses it.
		var claimedDeviceId by remember { mutableStateOf<String?>(null) }
		SignInSheet(
			deviceId = selected.id,
			deviceName = selected.model.ifEmpty { "Umbrel" },
			deviceModel = selected.model,
			target = Umbreld.Target(selected.id, listOf(selected.host) + selected.addresses),
			onPrepare = {
				if (claimedDeviceId != selected.id) {
					Umbreld.claimLocalHttpsIdentity(selected)
					claimedDeviceId = selected.id
				}
			},
			onSignedIn = { session, account ->
				val store = context.container.deviceStore
				val existing = store.device(selected.id)
				var device = existing?.mergeVerifiedDiscovery(selected) ?: com.umbrel.kit.SavedDevice(
					id = selected.id,
					name = selected.name,
					host = selected.host,
					addresses = selected.addresses,
					model = selected.model,
					lastAccountId = session.accountId,
				)
				if (account != null && account.userId == session.accountId) {
					device = device.saveAccountProfile(
						session.accountId, account.name, account.wallpaper.id, account.wallpaper.brandColorHsl,
						if (session.accountId == "0") "owner" else "member",
					)
				}
				store.save(device)
				model.signedIn(selected.id)
				prefetchHome(context.container, device, session)
			},
			onDismiss = model::dismissSignIn,
			onRemove = null,
		)
	}
}

@Composable
private fun SplashScreen() {
	Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
		Image(painterResource(R.drawable.umbrel_mark), contentDescription = null, modifier = Modifier.width(70.dp))
	}
}

/** Title and subtitle up top, the glowing 3D Umbrel icon centered, Continue at the bottom. */
@Composable
private fun WelcomeScreen(onContinue: () -> Unit) {
	val entrance by rememberEntrance()
	Column(Modifier.fillMaxSize().systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
		OnboardingHeader(
			title = "Your Umbrel.\nIn your pocket.",
			subtitle = "Manage your Umbrel, launch apps, and keep your photos backed up automatically.",
			modifier = Modifier.padding(top = 72.dp),
		)
		Spacer(Modifier.weight(1f))
		// The icon render carries its own transparency (its brightness), so it needs no blending
		// with the background. A blend would only see an empty layer while the screens fade.
		Image(
			painterResource(R.drawable.umbrel_icon_glow),
			contentDescription = null,
			modifier = Modifier.width(298.dp).aspectRatio(1f).graphicsLayer { alpha = entrance },
		)
		Spacer(Modifier.weight(1f))
		OnboardingButton("Continue", Modifier.bottomAction().graphicsLayer { alpha = entrance }, onClick = onContinue)
	}
}

/**
 * The radar while discovery runs. iOS shows a Local Network permission screen first;
 * Android grants local network access with INTERNET below target SDK 37, so the flow goes
 * straight here. Targeting 37 brings that permission (ACCESS_LOCAL_NETWORK) and the screen back.
 */
@Composable
private fun FindingScreen() {
	val entrance by rememberEntrance()
	Column(Modifier.fillMaxSize().systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
		OnboardingHeader(
			title = "Finding your Umbrel",
			subtitle = "Make sure your phone and Umbrel are on the same Wi-Fi network.",
			modifier = Modifier.padding(top = 90.dp),
		)
		Spacer(Modifier.weight(1f))
		Box(Modifier.graphicsLayer { alpha = entrance }, contentAlignment = Alignment.Center) {
			RadarRings()
			RadarSweep()
		}
		Spacer(Modifier.weight(2f))
	}
}

// SwiftUI's easeInOut curve.
private val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)

/**
 * The red error state. Motion stays quiet: the rings breathe slowly and the crossed
 * umbrella lands once with a small spring.
 */
@Composable
private fun NoDeviceScreen(onScanAgain: () -> Unit, onManual: () -> Unit) {
	val entrance by rememberEntrance()
	val breathing = rememberInfiniteTransition(label = "breathing")
	val ringAlpha by breathing.animateFloat(0.45f, 1f, infiniteRepeatable(tween(2_200, easing = EaseInOut), RepeatMode.Reverse), label = "alpha")
	val ringScale by breathing.animateFloat(0.985f, 1f, infiniteRepeatable(tween(2_200, easing = EaseInOut), RepeatMode.Reverse), label = "scale")
	// SwiftUI's spring(duration: 0.55, bounce: 0.35): damping ratio 1 − bounce, stiffness (2π / duration)².
	val landing = spring<Float>(dampingRatio = 0.65f, stiffness = 130.5f)
	val umbrellaScale = remember { Animatable(1.3f) }
	val umbrellaAlpha = remember { Animatable(0f) }
	LaunchedEffect(Unit) {
		delay(300)
		launch { umbrellaScale.animateTo(1f, landing) }
		umbrellaAlpha.animateTo(1f, landing)
	}
	Column(Modifier.fillMaxSize().systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
		Column(Modifier.padding(top = 90.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
			OnboardingHeader(title = "No device found", subtitle = "Make sure your phone and Umbrel are on the same Wi-Fi network.")
			ManualAddressPrompt(onManual)
		}
		Spacer(Modifier.weight(1f))
		Box(Modifier.graphicsLayer { alpha = entrance }, contentAlignment = Alignment.Center) {
			RadarRings(tint = Palette.error, modifier = Modifier.graphicsLayer {
				alpha = ringAlpha
				scaleX = ringScale
				scaleY = ringScale
			})
			Image(
				painterResource(R.drawable.crossed_umbrella),
				contentDescription = null,
				modifier = Modifier.width(60.dp).graphicsLayer {
					alpha = umbrellaAlpha.value.coerceIn(0f, 1f)
					scaleX = umbrellaScale.value
					scaleY = umbrellaScale.value
				},
			)
		}
		Spacer(Modifier.weight(2f))
		OnboardingButton(
			"Scan again",
			Modifier.bottomAction().graphicsLayer { alpha = entrance },
			style = OnboardingButtonStyle.PROMINENT,
			tint = Palette.error,
			onClick = onScanAgain,
		)
	}
}

private sealed class DiscoveryResult {
	data class Device(val device: IdentifiedDevice) : DiscoveryResult()
	data class Unverified(val device: Umbreld.UnverifiedDevice) : DiscoveryResult()
	data class UpdateRequired(val device: Umbreld.UpdateRequiredDevice) : DiscoveryResult()

	val key: String get() = when (this) {
		// Two records can share an id when another LAN device claims it under its own CA
		is Device -> "device:${device.id}@${device.host}"
		is Unverified -> "unverified:${device.host}"
		is UpdateRequired -> "update:${device.host}"
	}
	val model: String? get() = (this as? Device)?.device?.model
	val title: String get() = when (this) {
		is Device -> device.model
		is Unverified -> "Couldn’t connect"
		is UpdateRequired -> "Update to connect"
	}
	val subtitle: String get() = when (this) {
		is Device -> device.host
		is Unverified -> device.host
		is UpdateRequired -> device.host
	}
}

/** One discovered Umbrel as a centered hero, several as a swipeable card carousel. */
@Composable
private fun DeviceFoundScreen(
	state: OnboardingState,
	onConnect: (IdentifiedDevice) -> Unit,
	onRetry: (Umbreld.UnverifiedDevice) -> Unit,
	onManual: () -> Unit,
) {
	// The list needs unique keys, and a LAN device repeating an Umbrel's id at the same host
	// under its own CA would give two records the same one.
	val results = (
		state.devices.map(DiscoveryResult::Device) +
			state.unverified.map(DiscoveryResult::Unverified) +
			state.updateRequired.map(DiscoveryResult::UpdateRequired)
		).distinctBy { it.key }
	val entrance by rememberEntrance()
	if (results.size > 1) {
		Column(Modifier.fillMaxSize().systemBarsPadding()) {
			Column(Modifier.padding(horizontal = 33.dp).padding(top = 120.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
				Text("Found ${results.size} devices", color = Palette.textMuted, fontSize = 20.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold)
				ManualAddressPrompt(onManual, leading = true)
			}
			Spacer(Modifier.height(24.dp))
			val listState = rememberLazyListState()
			LazyRow(
				state = listState,
				modifier = Modifier.graphicsLayer { alpha = entrance },
				contentPadding = PaddingValues(horizontal = 20.dp),
				horizontalArrangement = Arrangement.spacedBy(20.dp),
				flingBehavior = rememberSnapFlingBehavior(listState, SnapPosition.Start),
			) {
				items(results, key = { it.key }) { result ->
					DeviceCard(result, state, onConnect, onRetry)
				}
			}
			Spacer(Modifier.weight(1f))
		}
	} else {
		val result = results.firstOrNull()
		Column(Modifier.fillMaxSize().systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
			Spacer(Modifier.weight(1f))
			Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
				Text("Found 1 device", color = Palette.textMuted, fontSize = CalloutSize, lineHeight = CalloutLineHeight, fontWeight = FontWeight.SemiBold)
				ManualAddressPrompt(onManual)
			}
			Spacer(Modifier.height(60.dp))
			if (result != null) DeviceHero(result, nameSize = 32.sp, Modifier.graphicsLayer { alpha = entrance })
			Spacer(Modifier.weight(2f))
			if (result != null) {
				Box(Modifier.bottomAction().graphicsLayer { alpha = entrance }) {
					ResultAction(result, state, fullWidth = true, onConnect, onRetry)
				}
			}
		}
	}
}

@Composable
private fun DeviceCard(
	result: DiscoveryResult,
	state: OnboardingState,
	onConnect: (IdentifiedDevice) -> Unit,
	onRetry: (Umbreld.UnverifiedDevice) -> Unit,
) {
	val shape = RoundedCornerShape(42.dp)
	// The fixed card has room for the "Couldn't connect" explanation and two actions only up
	// to the largest text size below the accessibility sizes
	val density = LocalDensity.current
	val cardDensity = if (result is DiscoveryResult.Unverified && density.fontScale > LargestStandardFontScale) {
		Density(density.density, LargestStandardFontScale)
	} else {
		density
	}
	CompositionLocalProvider(LocalDensity provides cardDensity) {
		Column(
			Modifier
				.size(width = 340.dp, height = 513.dp)
				.clip(shape)
				.background(Color.White.copy(alpha = 0.04f))
				.glassGlint(shape)
				.padding(30.dp),
			horizontalAlignment = Alignment.CenterHorizontally,
		) {
			Spacer(Modifier.weight(1f))
			DeviceHero(result, nameSize = 27.sp)
			Spacer(Modifier.weight(1f))
			ResultAction(result, state, fullWidth = false, onConnect, onRetry)
		}
	}
}

// The largest Android font scale step below the accessibility text sizes (see
// isAccessibilityTextSize)
private const val LargestStandardFontScale = 1.3f

@Composable
private fun DeviceHero(result: DiscoveryResult, nameSize: TextUnit, modifier: Modifier = Modifier) {
	Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(31.dp)) {
		UmbrelDeviceRender(result.model, UmbrelRenderPlacement.HERO, shadow = RenderShadow.Hero)
		Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
			Text(result.title, color = Color.White, fontSize = nameSize, fontWeight = FontWeight.SemiBold)
			Text(result.subtitle, color = Palette.textMuted, fontSize = CalloutSize, lineHeight = CalloutLineHeight)
			if (result is DiscoveryResult.Unverified) {
				Text(
					result.device.reason.explanation,
					color = Palette.textMuted,
					fontSize = FootnoteSize,
					lineHeight = FootnoteLineHeight,
					textAlign = TextAlign.Center,
					modifier = Modifier.widthIn(max = 280.dp).padding(top = 8.dp),
				)
			}
		}
	}
}

@Composable
private fun ResultAction(
	result: DiscoveryResult,
	state: OnboardingState,
	fullWidth: Boolean,
	onConnect: (IdentifiedDevice) -> Unit,
	onRetry: (Umbreld.UnverifiedDevice) -> Unit,
) {
	val context = LocalContext.current
	when (result) {
		is DiscoveryResult.Device -> when {
			result.device.id in state.savedIds -> AlreadyAdded()
			fullWidth -> OnboardingButton("Connect") { onConnect(result.device) }
			else -> ConnectButton("Connect") { onConnect(result.device) }
		}
		is DiscoveryResult.Unverified -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
			val retrying = result.device.host in state.retryingHosts
			val retry = { onRetry(result.device) }
			if (fullWidth) OnboardingButton("Try again", busy = retrying, onClick = retry) else ConnectButton("Try again", busy = retrying, onClick = retry)
			OpenInBrowser(result.device.host)
		}
		is DiscoveryResult.UpdateRequired -> {
			val open = { context.openUrl("http://${result.device.host}") }
			if (fullWidth) OnboardingButton("Update umbrelOS", onClick = open) else ConnectButton("Update umbrelOS", onClick = open)
		}
	}
}

/** The solid card button: a fixed indigo, 48 tall, with the rim light. A spinner replaces its title while busy. */
@Composable
private fun ConnectButton(title: String, busy: Boolean = false, onClick: () -> Unit) {
	Box(
		Modifier
			.fillMaxWidth()
			.heightIn(min = 48.dp)
			.clip(CircleShape)
			.background(Color(0xFF6155F5))
			.solidButtonRim(CircleShape)
			.clickable(enabled = !busy, onClick = onClick),
		contentAlignment = Alignment.Center,
	) {
		Text(
			title,
			color = Color.White.copy(alpha = if (busy) 0f else 1f),
			fontSize = HeadlineSize,
			lineHeight = HeadlineLineHeight,
			fontWeight = FontWeight.SemiBold,
		)
		if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
	}
}

/** "Open in browser" under a "Couldn't connect" answer: umbrelOS may still open there. */
@Composable
private fun OpenInBrowser(host: String) {
	val context = LocalContext.current
	Box(
		Modifier
			.fillMaxWidth()
			.heightIn(min = 44.dp)
			.clickable(role = Role.Button) { context.openUrl("http://$host") },
		contentAlignment = Alignment.Center,
	) {
		Text(
			"Open in browser",
			color = Palette.textMuted,
			fontSize = SubheadlineSize,
			lineHeight = SubheadlineLineHeight,
			fontWeight = FontWeight.SemiBold,
		)
	}
}

@Composable
private fun AlreadyAdded() {
	Row(
		Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.06f)),
		horizontalArrangement = Arrangement.Center,
		verticalAlignment = Alignment.CenterVertically,
	) {
		Icon(Symbols.CheckSemibold, contentDescription = null, tint = Palette.textMuted, modifier = Modifier.size(20.dp))
		Spacer(Modifier.width(6.dp))
		Text("Already added", color = Palette.textMuted, fontSize = HeadlineSize, lineHeight = HeadlineLineHeight, fontWeight = FontWeight.SemiBold)
	}
}

/**
 * A verified alternate route for an Umbrel the scan did not show. A successful check opens
 * sign-in over this screen; the device is not saved beforehand. Leaving cancels the check.
 */
@Composable
private fun ManualAddressScreen(
	savedIds: Set<String>,
	signingIn: Boolean,
	discover: suspend (String) -> Umbreld.ManualDiscoveryResult,
	onBack: () -> Unit,
	onFound: (IdentifiedDevice) -> Unit,
) {
	val context = LocalContext.current
	val scope = rememberCoroutineScope()
	val focusManager = LocalFocusManager.current
	val focus = remember { FocusRequester() }
	var address by remember { mutableStateOf("") }
	var error by remember { mutableStateOf<String?>(null) }
	var updateRequiredHost by remember { mutableStateOf<String?>(null) }
	// A current Umbrel answered here but couldn't prove its identity
	var unverified by remember { mutableStateOf<Umbreld.UnverifiedDevice?>(null) }
	var connection by remember { mutableStateOf<Job?>(null) }
	val connecting = connection != null

	// Focus the field on arrival and again whenever the sign-in sheet closes.
	LaunchedEffect(signingIn) { if (!signingIn) focus.requestFocus() }

	fun connect() {
		val submitted = address.trim()
		if (submitted.isEmpty() || connecting) return
		error = null
		updateRequiredHost = null
		// Close the keyboard before the sign-in sheet opens over this screen.
		focusManager.clearFocus()
		connection = scope.launch {
			try {
				val result = discover(submitted)
				// Try again keeps the previous answer on screen until this one arrives
				unverified = null
				when (result) {
					is Umbreld.ManualDiscoveryResult.Device ->
						if (result.value.id in savedIds) error = "This Umbrel has already been added." else onFound(result.value)
					is Umbreld.ManualDiscoveryResult.Unverified -> unverified = result.value
					is Umbreld.ManualDiscoveryResult.UpdateRequired -> updateRequiredHost = result.value.host
				}
			} catch (cancelled: CancellationException) {
				throw cancelled
			} catch (failure: Exception) {
				unverified = null
				error = failure.message ?: "Couldn’t connect."
			} finally {
				connection = null
			}
		}
	}

	Column(Modifier.fillMaxSize().systemBarsPadding().imePadding(), horizontalAlignment = Alignment.CenterHorizontally) {
		Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(top = 8.dp)) {
			CircleIconButton(Symbols.ArrowBackIosNewMedium, contentDescription = "Back", iconSize = 18.dp, onClick = onBack)
		}
		OnboardingHeader(
			title = "Connect by address",
			subtitle = "Enter your Umbrel’s IP address or hostname. If you’re away from home, use its Tailscale IP address or MagicDNS name. Tailscale must already be set up on this phone and your Umbrel.",
			modifier = Modifier.padding(top = 26.dp),
		)
		Spacer(Modifier.height(40.dp))
		Column(Modifier.fillMaxWidth().padding(horizontal = 31.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
			val fieldShape = RoundedCornerShape(14.dp)
			BasicTextField(
				value = address,
				onValueChange = {
					address = it
					error = null
					updateRequiredHost = null
					unverified = null
				},
				enabled = !connecting,
				singleLine = true,
				textStyle = TextStyle(fontFamily = interFor(17.sp), color = Color.White, fontSize = 17.sp),
				cursorBrush = SolidColor(Palette.purpleLight),
				keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
				keyboardActions = KeyboardActions(onGo = { connect() }),
				modifier = Modifier.fillMaxWidth().focusRequester(focus),
				decorationBox = { field ->
					Box(
						Modifier
							.fillMaxWidth()
							.height(52.dp)
							.clip(fieldShape)
							.background(Color(0xFF2C2C2E))
							.then(if (error != null) Modifier.border(1.dp, Palette.error, fieldShape) else Modifier)
							.padding(horizontal = 16.dp),
						contentAlignment = Alignment.CenterStart,
					) {
						if (address.isEmpty()) {
							Text("e.g. umbrel.local, umbrel, or 100.64.0.1", color = PlaceholderGray, fontSize = 17.sp, maxLines = 1)
						}
						field()
					}
				},
			)
			error?.let { Text(it, color = Palette.error, fontSize = FootnoteSize, lineHeight = FootnoteLineHeight) }
			if (updateRequiredHost != null) {
				Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
					Text("Update to connect", color = Color.White, fontSize = HeadlineSize, lineHeight = HeadlineLineHeight, fontWeight = FontWeight.SemiBold)
					Text("This Umbrel needs to be updated before it can connect to the app.", color = Palette.textMuted, fontSize = FootnoteSize, lineHeight = FootnoteLineHeight)
				}
			}
			unverified?.let { device ->
				Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
					Text("Couldn’t connect", color = Color.White, fontSize = HeadlineSize, lineHeight = HeadlineLineHeight, fontWeight = FontWeight.SemiBold)
					Text(device.reason.explanation, color = Palette.textMuted, fontSize = FootnoteSize, lineHeight = FootnoteLineHeight)
				}
			}
		}
		Spacer(Modifier.weight(1f).heightIn(min = 20.dp))
		val host = updateRequiredHost
		val unverifiedDevice = unverified
		if (host != null) {
			OnboardingButton("Update umbrelOS", Modifier.bottomAction(), style = OnboardingButtonStyle.PROMINENT) {
				context.openUrl("http://$host")
			}
		} else if (unverifiedDevice != null) {
			Column(Modifier.bottomAction(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
				OnboardingButton("Try again", style = OnboardingButtonStyle.PROMINENT, busy = connecting, onClick = ::connect)
				OpenInBrowser(unverifiedDevice.host)
			}
		} else {
			OnboardingButton(
				"Connect",
				Modifier.bottomAction(),
				style = OnboardingButtonStyle.PROMINENT,
				enabled = address.isNotBlank(),
				busy = connecting,
				onClick = ::connect,
			)
		}
	}
}

// The system placeholder label color in dark mode.
private val PlaceholderGray = Color(0x4DEBEBF5)

/** Success: the connected Umbrel's render, "Connected" and its model, and Continue into the app. */
@Composable
private fun ConnectedScreen(device: IdentifiedDevice?, onContinue: () -> Unit) {
	val entrance by rememberEntrance()
	Column(Modifier.fillMaxSize().systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
		Spacer(Modifier.weight(1f))
		UmbrelDeviceRender(device?.model, UmbrelRenderPlacement.HERO, shadow = RenderShadow.Hero)
		Spacer(Modifier.height(31.dp))
		Column(
			Modifier.graphicsLayer { alpha = entrance },
			horizontalAlignment = Alignment.CenterHorizontally,
			verticalArrangement = Arrangement.spacedBy(4.dp),
		) {
			Text("Connected", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
			Text(device?.model ?: "Umbrel", color = Palette.textMuted, fontSize = CalloutSize, lineHeight = CalloutLineHeight)
		}
		Spacer(Modifier.weight(2f))
		OnboardingButton("Continue", Modifier.bottomAction().graphicsLayer { alpha = entrance }, onClick = onContinue)
	}
}

/** The bottom action inset every onboarding screen uses: 31 from the sides, 8 above the safe area. */
private fun Modifier.bottomAction(): Modifier = padding(horizontal = 31.dp).padding(bottom = 8.dp)

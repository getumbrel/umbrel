package com.umbrel.android.main

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.umbrel.android.R
import com.umbrel.android.container
import com.umbrel.android.isSignedIn
import com.umbrel.android.onboarding.RenderShadow
import com.umbrel.android.onboarding.UmbrelDeviceRender
import com.umbrel.android.onboarding.UmbrelRenderPlacement
import com.umbrel.android.ui.AppleEaseOut
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.CircleIconButton
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.StatusDot
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.glassGlint
import com.umbrel.android.ui.isAccessibilityTextSize
import com.umbrel.kit.Config
import com.umbrel.kit.SavedDevice
import com.umbrel.kit.SecretStore
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

private val CardShape = RoundedCornerShape(24.dp)
private val CardBackground = Color(0xFF1C1C1C)
private val CardShadow = RenderShadow(0.16f, 8.dp, 8.dp)

/** What a device card's status line shows. */
internal enum class DeviceCardStatus { SIGNED_OUT, CHECKING, CONNECTED, OFFLINE }

/** Signed out wins over any reachability; a signed-in device is checking until a result is confirmed. */
internal fun deviceCardStatus(signedIn: Boolean, connection: ConnectionState): DeviceCardStatus = when {
	!signedIn -> DeviceCardStatus.SIGNED_OUT
	connection == ConnectionState.UNVERIFIED -> DeviceCardStatus.CHECKING
	connection == ConnectionState.CONNECTED -> DeviceCardStatus.CONNECTED
	else -> DeviceCardStatus.OFFLINE
}

/** The outcome of a card's authenticated check. */
internal sealed interface DeviceCheck {
	data object SignedOut : DeviceCheck
	data object Offline : DeviceCheck
	data class Connected(val user: Umbreld.UserInfo) : DeviceCheck
}

/**
 * A saved session means signed in, not reachable, so the card asks the Umbrel who is signed
 * in. Only a definitively missing or unreadable session is signed out. A 401 during the
 * request can remove the session, so a failure re-reads it instead of reporting that
 * signed-out state as an offline Umbrel.
 */
internal suspend fun checkDevice(
	readSession: suspend () -> SecretStore.SessionReadResult,
	fetchUser: suspend (Umbreld.Session) -> Umbreld.UserInfo,
): DeviceCheck {
	val read = readSession()
	val session = read.sessionOrCached
		?: return if (read.isSignedIn) DeviceCheck.Offline else DeviceCheck.SignedOut
	val user = try {
		fetchUser(session)
	} catch (cancelled: CancellationException) {
		throw cancelled
	} catch (error: Exception) {
		return if (readSession().isSignedIn) DeviceCheck.Offline else DeviceCheck.SignedOut
	}
	return DeviceCheck.Connected(user)
}

/**
 * The device switcher: a black screen with the Umbrel mark, a "+" to add another device, and
 * a card per saved device showing that device's wallpaper, render, name and current status.
 * Tapping a card opens that device. While an Umbrel is [removing], nothing opens and a
 * spinner stands in for the "+".
 */
@Composable
fun AllDevicesScreen(
	devices: List<SavedDevice>,
	signedIn: Map<String, Boolean>,
	connections: Map<String, DeviceConnectionSnapshot>,
	onSelect: (SavedDevice) -> Unit,
	onAdd: () -> Unit,
	removing: Boolean = false,
) {
	val density = LocalDensity.current
	val statusBar = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
	val navigationBar = with(density) { WindowInsets.navigationBars.getBottom(this).toDp() }

	Box(Modifier.fillMaxSize().background(Color.Black)) {
		Column(
			Modifier
				.fillMaxSize()
				.verticalScroll(rememberScrollState())
				.padding(horizontal = MainTheme.contentInset)
				.padding(top = statusBar + 56.dp, bottom = navigationBar + 32.dp),
			verticalArrangement = Arrangement.spacedBy(12.dp),
		) {
			for (device in devices) {
				key(device.id) {
					DeviceCard(
						device = device,
						signedIn = signedIn[device.id] == true,
						connection = connections[device.id] ?: DeviceConnectionSnapshot.UNVERIFIED,
						enabled = !removing,
						onClick = { onSelect(device) },
					)
				}
			}
		}

		Box(
			Modifier
				.fillMaxWidth()
				.height(statusBar + 120.dp)
				.background(Brush.verticalGradient(listOf(Color.Black, Color.Transparent))),
		)

		Header(removing, onAdd)
	}
}

@Composable
private fun Header(removing: Boolean, onAdd: () -> Unit) {
	Row(
		Modifier
			.fillMaxWidth()
			.statusBarsPadding()
			.padding(start = 28.dp, end = MainTheme.contentInset),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Image(painterResource(R.drawable.umbrel_mark), contentDescription = null, modifier = Modifier.height(19.dp))
		Spacer(Modifier.weight(1f))
		if (removing) {
			Box(Modifier.size(42.dp), contentAlignment = Alignment.Center) {
				CircularProgressIndicator(
					Modifier.size(20.dp).semantics { contentDescription = "Removing Umbrel" },
					color = Color.White.copy(alpha = 0.7f),
					strokeWidth = 2.dp,
				)
			}
		} else {
			// Material's plus is drawn smaller within its box than SF's, so the box is larger.
			CircleIconButton(Symbols.AddMedium, contentDescription = "Add Umbrel", iconSize = 26.dp, onClick = onAdd)
		}
	}
}

/** One device row: the device's wallpaper (dimmed) behind its render, name and status. */
@Composable
private fun DeviceCard(device: SavedDevice, signedIn: Boolean, connection: DeviceConnectionSnapshot, enabled: Boolean, onClick: () -> Unit) {
	val container = LocalContext.current.container
	val store = container.deviceStore
	val lifecycle = LocalLifecycleOwner.current.lifecycle
	val currentDevice by rememberUpdatedState(device)
	val currentSignedIn by rememberUpdatedState(signedIn)
	var userName by remember { mutableStateOf(device.userName) }
	var wallpaper by remember { mutableStateOf<ImageBitmap?>(null) }
	var showsConnectionProgress by remember { mutableStateOf(false) }
	val status = deviceCardStatus(signedIn, connection.state)

	// Runs each time the app comes to the foreground, and stops when it leaves.
	LaunchedEffect(lifecycle) {
		lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
			val device = currentDevice
			// Restore the cached wallpaper first, even when offline.
			device.wallpaperId?.let { id -> container.wallpapers.cachedCard(id)?.let { wallpaper = it.asImageBitmap() } }
			// Then refresh the name and wallpaper from the device if it's reachable, and persist
			// them so this card still renders correctly next launch and offline.
			if (!currentSignedIn || store.connections.isFresh(device.id)) return@repeatOnLifecycle
			val target = device.nativeTarget
			when (val result = checkDevice(readSession = { store.readSession(device.id) }, fetchUser = { Umbreld.user(target, it) })) {
				// The read already published the signed-out state, which the status line shows.
				DeviceCheck.SignedOut -> Unit
				DeviceCheck.Offline -> store.connections.record(device.id, ConnectionState.UNAVAILABLE)
				is DeviceCheck.Connected -> {
					val user = result.user
					store.connections.record(device.id, ConnectionState.CONNECTED)
					userName = user.name
					container.wallpapers.loadCard(user.wallpaper.id, target)?.let { wallpaper = it.asImageBitmap() }
					try {
						store.update(device.id) {
							it.saveAccountProfile(user.userId, user.name, user.wallpaper.id, user.wallpaper.brandColorHsl, user.role)
						}
					} catch (error: Config.StorageException) {
						// DeviceStore reports it; the storage alert shows over the list.
					}
				}
			}
		}
	}
	// A quick check shows nothing; the spinner only appears if it takes a while.
	LaunchedEffect(status == DeviceCardStatus.CHECKING) {
		showsConnectionProgress = false
		if (status != DeviceCardStatus.CHECKING) return@LaunchedEffect
		delay(400)
		showsConnectionProgress = true
	}

	Box(
		Modifier
			.fillMaxWidth()
			.defaultMinSize(minHeight = 147.dp)
			.clip(CardShape)
			.background(CardBackground)
			.glassGlint(CardShape)
			.clickable(enabled = enabled, onClick = onClick),
		contentAlignment = Alignment.CenterStart,
	) {
		CardWallpaper(wallpaper)
		Row(
			Modifier.padding(horizontal = 24.dp),
			horizontalArrangement = Arrangement.spacedBy(16.dp),
			verticalAlignment = Alignment.CenterVertically,
		) {
			UmbrelDeviceRender(device.model, UmbrelRenderPlacement.DEVICE_ROW, shadow = CardShadow)
			Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
				Text(
					buildAnnotatedString {
						userName?.let { withStyle(SpanStyle(color = Color.White)) { append("$it’s ") } }
						withStyle(SpanStyle(color = Color.White.copy(alpha = 0.7f))) { append(device.model ?: device.name) }
					},
					style = AppleType.title3,
					fontWeight = FontWeight.SemiBold,
					maxLines = if (isAccessibilityTextSize()) 2 else 1,
					overflow = TextOverflow.Ellipsis,
				)
				CardStatusLine(status, showsConnectionProgress, device.host)
			}
		}
	}
}

/** The wallpaper fills the card and fades in when it first arrives, under a 20% black dim. */
@Composable
private fun BoxScope.CardWallpaper(wallpaper: ImageBitmap?) {
	val opacity by animateFloatAsState(if (wallpaper != null) 1f else 0f, tween(200, easing = AppleEaseOut), label = "wallpaper")
	Box(Modifier.matchParentSize()) {
		if (wallpaper != null) {
			Image(
				wallpaper,
				contentDescription = null,
				contentScale = ContentScale.Crop,
				modifier = Modifier.fillMaxSize().graphicsLayer { alpha = opacity },
			)
		}
		Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.2f)))
	}
}

@Composable
private fun CardStatusLine(status: DeviceCardStatus, showsConnectionProgress: Boolean, host: String) {
	val style = AppleType.footnote.copy(fontWeight = FontWeight.Medium, color = Color.White)
	Row(
		Modifier.defaultMinSize(minHeight = 16.dp),
		horizontalArrangement = Arrangement.spacedBy(4.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		when (status) {
			DeviceCardStatus.SIGNED_OUT -> {
				StatusDot(MainTheme.gray)
				Text("Signed out", style = style)
			}
			DeviceCardStatus.CHECKING -> CircularProgressIndicator(
				Modifier
					.size(16.dp)
					.alpha(if (showsConnectionProgress) 1f else 0f)
					.then(
						if (showsConnectionProgress) Modifier.semantics { contentDescription = "Checking connection" }
						else Modifier.clearAndSetSemantics {},
					),
				color = Color.White.copy(alpha = 0.7f),
				strokeWidth = 2.dp,
			)
			DeviceCardStatus.CONNECTED -> {
				StatusDot(MainTheme.online)
				Text("Connected", style = style)
			}
			DeviceCardStatus.OFFLINE -> {
				StatusDot(MainTheme.gray)
				Text("Offline", style = style)
			}
		}
		// The host tells apart Umbrels that share an owner and model. It stays on the status
		// line and gives way to the status by shortening in the middle.
		val hostStyle = style.copy(color = Color.White.copy(alpha = 0.7f))
		Text("\u00B7", style = hostStyle)
		Text(host, style = hostStyle, maxLines = 1, overflow = TextOverflow.MiddleEllipsis, modifier = Modifier.weight(1f, fill = false))
	}
}

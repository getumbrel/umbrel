package com.umbrel.android.main

import android.content.ClipData
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.umbrel.android.R
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.InfoPageDivider
import com.umbrel.android.ui.InfoPageRow
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.Symbols
import com.umbrel.kit.SavedDevice
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * How the app reaches the Umbrel right now and every address it knows. iOS also has a Local
 * Network Access Off state with an Open Settings action; apps targeting Android 16 (API 36)
 * or lower get local network access with the INTERNET permission, so that state can't occur.
 */
@Composable
internal fun ConnectionDetailsPage(state: MainUiState, hasKnownTailscaleAddress: Boolean, modifier: Modifier = Modifier) {
	val connection = state.connectionState
	val route = state.connectionRoute
	val knownAddresses = state.device.connectionHosts
	Column(
		modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 20.dp, bottom = 32.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
		verticalArrangement = Arrangement.spacedBy(24.dp),
	) {
		Column(
			Modifier.padding(horizontal = 12.dp),
			horizontalAlignment = Alignment.CenterHorizontally,
			verticalArrangement = Arrangement.spacedBy(14.dp),
		) {
			HeroGraphic(connection, route, state.identityChanged)
			Text(connectionTitle(connection, route, state.identityChanged), style = AppleType.title2, fontWeight = FontWeight.Bold, color = Color.White, textAlign = TextAlign.Center)
			Text(
				connectionMessage(connection, route, hasKnownTailscaleAddress, state.identityChanged),
				style = AppleType.subheadline,
				color = MainTheme.gray,
				textAlign = TextAlign.Center,
			)
		}
		if (connection == ConnectionState.CONNECTED) {
			Column(Modifier.fillMaxWidth().background(MainTheme.sheetRow, RoundedCornerShape(20.dp))) {
				ConnectionDetails(route)
			}
		}
		if (connection != ConnectionState.UNVERIFIED && knownAddresses.isNotEmpty()) {
			KnownAddresses(knownAddresses)
		}
	}
}

@Composable
private fun HeroGraphic(connection: ConnectionState, route: ConnectionRoute?, identityChanged: Boolean) {
	if (connection == ConnectionState.CONNECTED && route == ConnectionRoute.TAILSCALE) {
		Image(painterResource(R.drawable.tailscale), contentDescription = null, modifier = Modifier.size(76.dp).clip(RoundedCornerShape(18.dp)))
		return
	}
	Box(Modifier.size(76.dp).background(Color.White.copy(alpha = 0.08f), CircleShape), contentAlignment = Alignment.Center) {
		val icon = heroIcon(connection, route, identityChanged)
		if (icon == null) {
			CircularProgressIndicator(Modifier.size(30.dp), color = Color.White, strokeWidth = 3.dp)
		} else {
			Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(heroIconSize(connection, identityChanged)))
		}
	}
}

// The hero symbol, or null while the first check runs and a spinner shows instead.
private fun heroIcon(connection: ConnectionState, route: ConnectionRoute?, identityChanged: Boolean): ImageVector? = when (connection) {
	ConnectionState.UNVERIFIED -> null
	ConnectionState.CONNECTED -> if (route == ConnectionRoute.LOCAL) Symbols.WifiSemibold else Symbols.LanguageSemibold
	ConnectionState.UNAVAILABLE -> if (identityChanged) Symbols.LockWarningSemibold else Symbols.WifiAlertSemibold
}

// Sized so each draws as large as its SF Symbol does.
private fun heroIconSize(connection: ConnectionState, identityChanged: Boolean): Dp = when {
	connection != ConnectionState.UNAVAILABLE -> 40.dp
	identityChanged -> 45.dp
	else -> 44.dp
}

@Composable
private fun ConnectionDetails(route: ConnectionRoute?) {
	when (route) {
		ConnectionRoute.TAILSCALE -> {
			InfoPageRow(Symbols.LockMedium, "End-to-end encrypted", "Traffic between this phone and your Umbrel is encrypted by Tailscale.")
			InfoPageDivider()
			InfoPageRow(Symbols.VerifiedUserMedium, "Private access", "Only devices with access to your tailnet can reach your Umbrel this way.")
		}
		ConnectionRoute.LOCAL -> {
			InfoPageRow(Symbols.LockMedium, "Encrypted with HTTPS", "Traffic between this phone and your Umbrel is encrypted with HTTPS.")
			InfoPageDivider()
			InfoPageRow(
				Symbols.VerifiedUserMedium,
				"Verified connection",
				"The app verifies your Umbrel’s HTTPS certificate when establishing the connection.",
			)
		}
		null -> InfoPageRow(Symbols.LockMedium, "Encrypted connection", "Traffic between this phone and your Umbrel is encrypted.")
	}
}

@Composable
private fun KnownAddresses(addresses: List<String>) {
	val clipboard = LocalClipboard.current
	val scope = rememberCoroutineScope()
	var copiedAddress by remember { mutableStateOf<String?>(null) }
	LaunchedEffect(copiedAddress) {
		if (copiedAddress == null) return@LaunchedEffect
		delay(1_500)
		copiedAddress = null
	}
	Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
		Text(
			"Known addresses",
			style = AppleType.footnote,
			fontWeight = FontWeight.SemiBold,
			color = MainTheme.gray,
			modifier = Modifier.padding(horizontal = 4.dp),
		)
		Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MainTheme.sheetRow)) {
			addresses.forEachIndexed { index, address ->
				KnownAddressRow(address, copied = copiedAddress == address) {
					scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Address", address))) }
					copiedAddress = address
				}
				if (index < addresses.lastIndex) InfoPageDivider()
			}
		}
	}
}

@Composable
private fun KnownAddressRow(address: String, copied: Boolean, onCopy: () -> Unit) {
	val tailscale = SavedDevice.isTailscaleAddress(address)
	val kind = if (tailscale) "Tailscale" else "Local network"
	Row(
		Modifier
			.fillMaxWidth()
			.clickable(onClickLabel = "Copy the address", role = Role.Button, onClick = onCopy)
			.semantics { contentDescription = "$kind address, $address" }
			.padding(16.dp),
		horizontalArrangement = Arrangement.spacedBy(14.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
			Icon(
				if (tailscale) Symbols.LanguageMedium else Symbols.WifiMedium,
				contentDescription = null,
				tint = Color.White.copy(alpha = 0.9f),
				modifier = Modifier.size(20.dp),
			)
		}
		Column(Modifier.weight(1f).clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
			Text(kind, style = AppleType.subheadline, fontWeight = FontWeight.SemiBold, color = Color.White)
			Text(
				address,
				style = AppleType.footnote.copy(fontFamily = FontFamily.Monospace),
				color = MainTheme.gray,
				maxLines = 1,
				overflow = TextOverflow.MiddleEllipsis,
			)
		}
		Icon(
			if (copied) Symbols.CheckMedium else Symbols.ContentCopyMedium,
			contentDescription = null,
			tint = MainTheme.gray,
			modifier = Modifier.size(16.dp),
		)
	}
}

internal fun connectionTitle(connection: ConnectionState, route: ConnectionRoute?, identityChanged: Boolean = false): String = when (connection) {
	ConnectionState.CONNECTED -> when (route) {
		ConnectionRoute.LOCAL -> "Connected locally"
		ConnectionRoute.TAILSCALE -> "Connected through Tailscale"
		null -> "Connected"
	}
	ConnectionState.UNAVAILABLE -> if (identityChanged) "Not recognized" else "Not connected"
	ConnectionState.UNVERIFIED -> "Checking connection"
}

internal fun connectionMessage(
	connection: ConnectionState,
	route: ConnectionRoute?,
	hasKnownTailscaleAddress: Boolean,
	identityChanged: Boolean = false,
): String = when (connection) {
	ConnectionState.CONNECTED -> when (route) {
		ConnectionRoute.LOCAL -> "This phone is connected directly to your Umbrel over your local network."
		ConnectionRoute.TAILSCALE -> "This phone is connected through your private Tailscale network."
		null -> "This phone is securely connected to your Umbrel."
	}
	ConnectionState.UNAVAILABLE -> if (identityChanged) {
		"This usually happens after your Umbrel or its certificate is reset. Reconnect your Umbrel from Home to keep using it in this app."
	} else if (hasKnownTailscaleAddress) {
		"Make sure your Umbrel is turned on. Connect this phone to the same local network, or turn on Tailscale."
	} else {
		"Make sure your Umbrel is turned on and this phone is connected to the same network."
	}
	ConnectionState.UNVERIFIED -> "Checking how this phone can reach your Umbrel."
}

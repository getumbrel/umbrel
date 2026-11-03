package com.umbrel.android.main

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.umbrel.android.R
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PageSheet
import com.umbrel.android.ui.PrimaryActionButton
import com.umbrel.android.ui.SheetToolbar
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.interFor
import com.umbrel.android.ui.openExternal
import com.umbrel.android.ui.openUrl
import kotlinx.coroutines.launch

// Tailscale's Android app on Google Play.
private const val TAILSCALE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.tailscale.ipn"

/** The Tailscale explanation and actions as a sheet, presented from Home's backup notice. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TailscaleSetupSheet(model: MainViewModel, state: MainUiState, onDismiss: () -> Unit) {
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	PageSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
		Column(Modifier.fillMaxHeight().navigationBarsPadding()) {
			SheetToolbar("Tailscale", onClose = onDismiss)
			TailscaleSetupContent(model, state)
		}
	}
}

/**
 * One explanation and set of actions wherever Tailscale matters. Umbrel can tell whether
 * its own Tailscale app has an address, but Android doesn't reveal another app's VPN
 * state, so the phone step links to Tailscale and reports only whether this phone can
 * reach the Umbrel's Tailscale address.
 */
@Composable
fun TailscaleSetupContent(model: MainViewModel, state: MainUiState, modifier: Modifier = Modifier) {
	val context = LocalContext.current
	val scope = rememberCoroutineScope()
	var isOpeningUmbrel by remember { mutableStateOf(false) }
	var showsUmbrelUnavailable by remember { mutableStateOf(false) }

	// A reported address shows Umbrel-side setup happened; a successful live probe is
	// stronger evidence.
	val umbrelSetupComplete = state.umbrelHasTailscaleAddress || state.tailscaleAvailableOnThisPhone == true
	// Checking is a first-load state; later checks keep the last result on screen.
	val isCheckingPhone = state.tailscaleAvailabilityCheckInProgress && state.tailscaleAvailableOnThisPhone == null
	val phoneReachesUmbrel = state.tailscaleAvailableOnThisPhone == true

	fun openTailscaleOnUmbrel() {
		if (isOpeningUmbrel) return
		isOpeningUmbrel = true
		scope.launch {
			try {
				val app = state.tailscaleApp
				val opened = if (app != null) model.browser.open(app) else model.browser.openUmbrel("/app-store/tailscale")
				if (!opened) showsUmbrelUnavailable = true
			} finally {
				isOpeningUmbrel = false
			}
		}
	}

	Column(
		modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 20.dp, bottom = 32.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
		verticalArrangement = Arrangement.spacedBy(24.dp),
	) {
		Column(Modifier.padding(horizontal = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
			Image(painterResource(R.drawable.tailscale), contentDescription = null, modifier = Modifier.size(76.dp).clip(RoundedCornerShape(18.dp)))
			Text("Connect from anywhere", style = AppleType.title2, fontWeight = FontWeight.Bold, color = Color.White, textAlign = TextAlign.Center)
			Text(
				"Tailscale privately connects this phone to your Umbrel from anywhere, so Photo Backup works away from home too.",
				style = AppleType.subheadline,
				color = MainTheme.gray,
				textAlign = TextAlign.Center,
			)
		}

		Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
			SetupStep(
				number = 1,
				title = when {
					umbrelSetupComplete -> "Your Umbrel"
					!state.canManageApps -> "Ask the owner"
					else -> "Set up your Umbrel"
				},
				message = when {
					umbrelSetupComplete -> "Tailscale is set up on this Umbrel."
					!state.canManageApps -> "The owner needs to set up Tailscale on this Umbrel and share access with you."
					state.tailscaleApp != null -> "Open Tailscale on your Umbrel and sign in to finish setup."
					else -> "Install Tailscale from the Umbrel App Store, then open it and sign in."
				},
				isComplete = umbrelSetupComplete,
			)
			SetupStep(
				number = 2,
				title = when {
					isCheckingPhone -> "Checking this phone"
					phoneReachesUmbrel -> "This phone"
					else -> "Connect this phone"
				},
				message = when {
					isCheckingPhone -> "Checking the Tailscale connection…"
					phoneReachesUmbrel -> "This phone can reach your Umbrel through Tailscale."
					!state.canManageApps -> "Make sure you’ve accepted the owner’s Tailscale invitation, then connect Tailscale on this phone."
					else -> "Make sure Tailscale is connected on this phone and your Umbrel. If you don’t have it on this phone, install it from Google Play."
				},
				isComplete = phoneReachesUmbrel,
				isChecking = isCheckingPhone,
			)
		}

		if (!umbrelSetupComplete && state.canManageApps) {
			PrimaryActionButton(
				title = when {
					isOpeningUmbrel -> "Opening…"
					state.tailscaleApp == null -> "Install Tailscale on Umbrel"
					else -> "Open Tailscale on Umbrel"
				},
				isLoading = isOpeningUmbrel,
				onClick = ::openTailscaleOnUmbrel,
			)
		} else if (!isCheckingPhone && state.tailscaleAvailableOnThisPhone == false) {
			PrimaryActionButton("View Tailscale in Google Play") { context.openExternal(TAILSCALE_PLAY_URL) }
		}
	}

	if (showsUmbrelUnavailable) {
		AlertDialog(
			onDismissRequest = { showsUmbrelUnavailable = false },
			title = { Text("Can’t Open Umbrel") },
			text = { Text("Connect to your Umbrel locally, then try again.") },
			confirmButton = { TextButton(onClick = { showsUmbrelUnavailable = false }) { Text("OK") } },
		)
	}
}

@Composable
private fun SetupStep(number: Int, title: String, message: String, isComplete: Boolean = false, isChecking: Boolean = false) {
	Row(
		Modifier.fillMaxWidth().background(MainTheme.sheetRow, RoundedCornerShape(20.dp)).padding(18.dp),
		horizontalArrangement = Arrangement.spacedBy(14.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Box(
			Modifier.size(32.dp).background(Color.White.copy(alpha = if (isComplete) 0.12f else 0.08f), CircleShape),
			contentAlignment = Alignment.Center,
		) {
			when {
				isChecking -> CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
				isComplete -> Icon(Symbols.CheckBold, contentDescription = "Done", tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(16.dp))
				else -> Text("$number", style = TextStyle(fontFamily = interFor(13.sp), fontSize = 13.sp, fontWeight = FontWeight.SemiBold), color = Color.White)
			}
		}
		Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
			Text(title, style = AppleType.subheadline, fontWeight = FontWeight.SemiBold, color = Color.White)
			Text(message, style = AppleType.footnote, color = MainTheme.gray)
		}
	}
}

package com.umbrel.android.main

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.umbrel.android.BuildConfig
import com.umbrel.android.onboarding.RenderShadow
import com.umbrel.android.onboarding.UmbrelDeviceRender
import com.umbrel.android.onboarding.UmbrelRenderPlacement
import com.umbrel.android.ui.AppleEaseOut
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.LocalBrandColor
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PageSheet
import com.umbrel.android.ui.SettingsDivider
import com.umbrel.android.ui.SettingsRow
import com.umbrel.android.ui.SettingsSection
import com.umbrel.android.ui.SettingsToggleRow
import com.umbrel.android.ui.SettingsValue
import com.umbrel.android.ui.SheetToolbar
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.formatStorageSize
import com.umbrel.android.ui.glassControl
import kotlinx.coroutines.launch

/** The pages pushed inside the Profile sheet. */
enum class ProfileDestination { REMOTE_ACCESS, CONNECTION, FOLDERS, FOLDER_SETUP }

// The device render's shadow on the Profile card.
private val ProfileRenderShadow = RenderShadow(opacity = 0.16f, radius = 8.dp, y = 16.dp)

/**
 * The Profile sheet, presented over the tabs: the device card, connection, photo backup,
 * notification and permission settings, sign out and the version. [destination] opens it
 * with that page already pushed, as Home's connection status does; back returns to the root.
 * Turning backup on here pushes the folder choice that comes with it ([choosingFolders]),
 * so one sheet shows at a time.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(
	model: MainViewModel,
	state: MainUiState,
	folders: List<LibraryFolder>,
	choosingFolders: Boolean,
	destination: ProfileDestination?,
	onDismiss: () -> Unit,
) {
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	val scope = rememberCoroutineScope()
	var page by rememberSaveable { mutableStateOf(destination) }
	// The root keeps its scroll position under a pushed page, as a navigation stack does.
	val pageStates = rememberSaveableStateHolder()
	LaunchedEffect(choosingFolders) {
		if (choosingFolders) page = ProfileDestination.FOLDER_SETUP else if (page == ProfileDestination.FOLDER_SETUP) page = null
	}

	fun close() {
		scope.launch { sheetState.hide() }.invokeOnCompletion {
			if (!sheetState.isVisible) onDismiss()
		}
	}

	PageSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
		// Leaving the folder choice starts backup with it, as Start Backup does.
		BackHandler(enabled = page != null) { if (page == ProfileDestination.FOLDER_SETUP) model.confirmFolderChoice() else page = null }
		AnimatedContent(
			page,
			transitionSpec = {
				val forward = targetState != null
				(
					slideInHorizontally(tween(350, easing = AppleEaseOut)) { if (forward) it else -it / 3 } togetherWith
						slideOutHorizontally(tween(350, easing = AppleEaseOut)) { if (forward) -it / 3 else it }
				).apply {
					// A popped page slides away above the root, as on a navigation stack.
					targetContentZIndex = if (forward) 1f else -1f
				}
			},
			modifier = Modifier.fillMaxHeight().navigationBarsPadding(),
			label = "profilePage",
		) { current ->
			pageStates.SaveableStateProvider(current?.name ?: "root") {
				Column(Modifier.fillMaxSize().background(MainTheme.sheet)) {
					when (current) {
						null -> {
							SheetToolbar("Profile", onClose = ::close)
							ProfileRoot(model, state, folders, onOpen = { page = it }, onSignOut = { model.signOut(onDismiss) })
						}
						ProfileDestination.REMOTE_ACCESS -> {
							SheetToolbar("Tailscale", onClose = null, onBack = { page = null })
							TailscaleSetupContent(model, state)
						}
						ProfileDestination.CONNECTION -> {
							SheetToolbar("Connection", onClose = null, onBack = { page = null })
							ConnectionDetailsPage(state, hasKnownTailscaleAddress = model.tailscaleAvailabilityHost() != null)
						}
						ProfileDestination.FOLDERS -> {
							SheetToolbar("Folders", onClose = null, onBack = { page = null })
							FoldersPage(model, state, folders)
						}
						ProfileDestination.FOLDER_SETUP -> {
							SheetToolbar("Photo Backup", onClose = null)
							FolderSetupPage(model, state, folders, onStart = model::confirmFolderChoice, modifier = Modifier.weight(1f))
						}
					}
				}
			}
		}
	}
}

@Composable
private fun ProfileRoot(
	model: MainViewModel,
	state: MainUiState,
	folders: List<LibraryFolder>,
	onOpen: (ProfileDestination) -> Unit,
	onSignOut: () -> Unit,
) {
	val photoBackup = rememberPhotoBackupControls(model, state)
	var confirmingSignOut by rememberSaveable { mutableStateOf(false) }
	Column(
		Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		DeviceCard(state, Modifier.padding(top = 20.dp, bottom = 10.dp))
		ConnectionSection(state, onOpen)
		PhotosSection(model, state, photoBackup, folders, onOpenFolders = { onOpen(ProfileDestination.FOLDERS) })
		NotificationSection()
		PermissionsSection(photoBackup)
		SignOutButton(Modifier.padding(vertical = 10.dp)) { confirmingSignOut = true }
		Text(
			"Umbrel, Inc. · Version ${BuildConfig.VERSION_NAME}",
			style = AppleType.footnote,
			color = MainTheme.gray,
			modifier = Modifier.padding(vertical = 10.dp),
		)
	}
	if (confirmingSignOut) {
		AlertDialog(
			onDismissRequest = { confirmingSignOut = false },
			title = { Text("Sign out of this Umbrel?") },
			text = { Text("Signing out pauses photo and video backups from this phone and any notifications until you sign in again.") },
			confirmButton = {
				TextButton(onClick = {
					confirmingSignOut = false
					onSignOut()
				}) { Text("Sign Out", color = MainTheme.red) }
			},
			dismissButton = { TextButton(onClick = { confirmingSignOut = false }) { Text("Cancel") } },
		)
	}
}

/** Greeting, device render, model and storage, and how the Umbrel is reachable. */
@Composable
private fun DeviceCard(state: MainUiState, modifier: Modifier = Modifier) {
	val brand = LocalBrandColor.current
	val device = state.device
	Column(
		modifier
			.fillMaxWidth()
			.background(MainTheme.sheetRow, RoundedCornerShape(20.dp))
			.padding(horizontal = 16.dp, vertical = 24.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
		verticalArrangement = Arrangement.spacedBy(20.dp),
	) {
		Text(
			"👋 Hey, ${state.userName ?: "there"}!",
			style = AppleType.title2,
			fontWeight = FontWeight.SemiBold,
			color = Color.White.copy(alpha = 0.9f),
			maxLines = 2,
			overflow = TextOverflow.Ellipsis,
			textAlign = TextAlign.Center,
		)
		Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
			UmbrelDeviceRender(device.model, UmbrelRenderPlacement.PROFILE, shadow = ProfileRenderShadow)
			Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
				// "Umbrel Pro · 4TB", with storage once disk usage has loaded.
				val deviceLine = state.disk?.let { "${state.deviceLabel} · ${formatStorageSize(it.size)}" } ?: state.deviceLabel
				Text(deviceLine, style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = Color.White)
				val address = device.addresses.firstOrNull()?.takeIf { it != device.host }
				val reachability = buildAnnotatedString {
					withStyle(SpanStyle(color = brand)) { append(device.host) }
					if (address != null) {
						withStyle(SpanStyle(color = Color.White.copy(alpha = 0.6f))) { append(" · ") }
						withStyle(SpanStyle(color = brand)) { append(address) }
					}
				}
				Text(reachability, style = AppleType.footnote)
			}
		}
	}
}

@Composable
private fun ConnectionSection(state: MainUiState, onOpen: (ProfileDestination) -> Unit) {
	SettingsSection("Connection") {
		SettingsRow(
			Symbols.Language,
			"Remote access",
			modifier = Modifier.clickable(role = Role.Button) { onOpen(ProfileDestination.REMOTE_ACCESS) },
		) {
			SettingsValue(state.tailscaleConnectionStatus, chevron = true)
		}
		SettingsDivider()
		SettingsRow(
			Symbols.ShieldLock,
			"Current connection",
			modifier = Modifier.clickable(role = Role.Button) { onOpen(ProfileDestination.CONNECTION) },
		) {
			SettingsValue(currentConnectionLabel(state.connectionState, state.connectionRoute, state.identityChanged), chevron = true)
		}
	}
}

/** A static preview of the notification settings, under a "Coming Soon" badge. */
@Composable
private fun NotificationSection() {
	SettingsSection("Notifications", badge = "Coming Soon") {
		Column(Modifier.alpha(0.45f)) {
			SettingsToggleRow(Symbols.PowerSettingsNew, "Device offline alert", checked = false, onCheckedChange = {}, enabled = false)
			SettingsDivider()
			SettingsToggleRow(Symbols.DriveWarning, "Storage alert", checked = false, onCheckedChange = {}, enabled = false, iconSize = 24.dp)
			SettingsDivider()
			SettingsToggleRow(Symbols.ArrowCircleUp, "umbrelOS updates", checked = false, onCheckedChange = {}, enabled = false)
			SettingsDivider()
			SettingsToggleRow(Symbols.AppBadge, "umbrelOS app updates", checked = false, onCheckedChange = {}, enabled = false)
		}
	}
}

/**
 * iOS also lists Local Network Access here. Apps targeting Android 16 (API 36) or lower get
 * local network access with the INTERNET permission, so there is no setting to show.
 */
@Composable
private fun PermissionsSection(photoBackup: PhotoBackupControls) {
	SettingsSection("Permissions") {
		PhotoLibraryAccessRow(photoBackup)
		SettingsDivider()
		SettingsRow(Symbols.Notifications, "Notifications") {
			SettingsValue("Coming Soon")
		}
	}
}

@Composable
private fun SignOutButton(modifier: Modifier = Modifier, onClick: () -> Unit) {
	Box(
		modifier
			.height(44.dp)
			.clip(CircleShape)
			.glassControl(CircleShape)
			.clickable(role = Role.Button, onClick = onClick)
			.padding(horizontal = 16.dp),
		contentAlignment = Alignment.Center,
	) {
		Text("Sign out", style = AppleType.footnote, fontWeight = FontWeight.SemiBold, color = MainTheme.red)
	}
}

/** The Profile row's summary of how the app reaches the Umbrel right now. */
internal fun currentConnectionLabel(connection: ConnectionState, route: ConnectionRoute?, identityChanged: Boolean = false): String = when (connection) {
	ConnectionState.UNVERIFIED -> "Checking…"
	ConnectionState.CONNECTED -> when (route) {
		ConnectionRoute.LOCAL -> "Local"
		ConnectionRoute.TAILSCALE -> "Tailscale"
		null -> "Connected"
	}
	ConnectionState.UNAVAILABLE -> if (identityChanged) "Not recognized" else "Offline"
}

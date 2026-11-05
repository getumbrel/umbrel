package com.umbrel.android.main

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.text.format.DateFormat
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.umbrel.android.container
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.GlassMenu
import com.umbrel.android.ui.GlassMenuItem
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PillButton
import com.umbrel.android.ui.SettingsDivider
import com.umbrel.android.ui.SettingsRow
import com.umbrel.android.ui.SettingsSection
import com.umbrel.android.ui.SettingsToggleRow
import com.umbrel.android.ui.SettingsValue
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.openAppSettings
import com.umbrel.kit.backup.PhotoBackupPreference
import com.umbrel.kit.backup.PhotoLibraryAccess
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Photo library access as the Permissions row shows it. Android reports only granted or
 * not; whether the system will still ask comes from the rationale check, which is false both
 * before the first request and after a permanent denial. [of] takes whether access was ever
 * requested, which the kit remembers across launches, to tell those two apart.
 */
internal enum class PhotoAccess(val label: String) {
	FULL("Full Access"),
	LIMITED("Limited"),
	NOT_DETERMINED("Set Up"),
	DENIED("Off"),

	// Denied for good: the system no longer shows its request, so only Settings can grant it.
	BLOCKED("Off");

	/** Without access, whether Android still shows its request. */
	val canRequest: Boolean get() = this == NOT_DETERMINED || this == DENIED

	companion object {
		fun of(full: Boolean, partial: Boolean, showsRationale: Boolean, requested: Boolean): PhotoAccess = when {
			full -> FULL
			partial -> LIMITED
			showsRationale -> DENIED
			requested -> BLOCKED
			else -> NOT_DETERMINED
		}
	}
}

/** The photo library and notification requests behind backup setup, shared by Profile and Home. */
internal class PhotoAccessRequests(
	val access: PhotoAccess,
	/**
	 * With "Select photos" access, whether Android has stopped offering "Allow all" in its
	 * dialog. Choosing a selection turns down full access, and after two of those Android
	 * treats it as "don't ask again" (USER_FIXED): asking again shows only its photo picker,
	 * so full access is granted in Settings.
	 */
	val allPhotosNeedSettings: Boolean,
	/**
	 * Asks for photo access, or opens Settings once Android no longer shows its dialog.
	 * [turningBackupOn] marks the request that answers turning backup on: notifications are
	 * asked for next, and a refusal turns backup back off.
	 */
	val requestLibraryAccess: (turningBackupOn: Boolean) -> Unit,
	val requestNotifications: () -> Unit,
	val openSettings: () -> Unit,
)

/**
 * Turning backup on asks for photo access first, then on Android 13 and later for
 * notifications, which show user-started transfers. The result of the photo request goes to
 * the view model, which keeps backup on when access (full or a selection) was granted and
 * turns it back off when it was refused in answer to turning it on. A refusal at any other
 * time leaves backup paused.
 */
@Composable
internal fun rememberPhotoAccessRequests(model: MainViewModel, state: MainUiState): PhotoAccessRequests {
	val context = LocalContext.current
	val activity = LocalActivity.current
	val backup = context.container.backup
	val libraryPermissions = remember(backup) { backup.libraryPermissions() }
	var showsRationale by remember { mutableStateOf(false) }
	var turningBackupOn by remember { mutableStateOf(false) }

	fun readRationale(): Boolean = activity != null && ActivityCompat.shouldShowRequestPermissionRationale(activity, libraryPermissions.first())

	// Access can change in Settings while the app is in the background.
	LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { showsRationale = readRationale() }

	val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
	val library = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
		showsRationale = readRationale()
		model.onPermissionsChanged(turningBackupOn)
		if (turningBackupOn && backup.libraryAccess().canReadLibrary && needsNotificationPermission(context)) {
			notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
		}
		turningBackupOn = false
	}
	val access = PhotoAccess.of(
		full = state.photoLibraryAccess == PhotoLibraryAccess.FULL,
		partial = state.photoLibraryAccess == PhotoLibraryAccess.SELECTED,
		showsRationale = showsRationale,
		requested = backup.libraryPermissionRequested,
	)
	return PhotoAccessRequests(
		access = access,
		// The rationale check is false once the request can no longer be shown.
		allPhotosNeedSettings = access == PhotoAccess.LIMITED && backup.libraryPermissionRequested && !showsRationale,
		requestLibraryAccess = { turningOn ->
			if (access == PhotoAccess.BLOCKED) {
				context.openAppSettings()
			} else {
				backup.noteLibraryPermissionRequested()
				turningBackupOn = turningOn
				library.launch(libraryPermissions)
			}
		},
		requestNotifications = { if (needsNotificationPermission(context)) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) },
		openSettings = context::openAppSettings,
	)
}

/** What the Photos toggles and the Photo Library Access row show and do. */
internal class PhotoBackupControls(
	val access: PhotoAccess,
	val allPhotosNeedSettings: Boolean,
	val preference: PhotoBackupPreference,
	val setPreference: (PhotoBackupPreference) -> Unit,
	val requestLibraryAccess: () -> Unit,
	val openSettings: () -> Unit,
)

/**
 * The toggles are durable intent, as on iOS: a change is saved at once and the switch stays
 * on while photo access and the Umbrel are pending. Turning backup on without photo access
 * asks for it; a refusal turns the toggles back off. Access lost later only pauses backup.
 */
@Composable
internal fun rememberPhotoBackupControls(model: MainViewModel, state: MainUiState): PhotoBackupControls {
	val requests = rememberPhotoAccessRequests(model, state)
	return PhotoBackupControls(
		access = requests.access,
		allPhotosNeedSettings = requests.allPhotosNeedSettings,
		preference = state.backupPreference,
		setPreference = { preference ->
			val turningOn = preference.isEnabled && !state.backupPreference.isEnabled
			model.setBackupPreference(preference)
			when {
				preference.isEnabled && !state.libraryAccess -> requests.requestLibraryAccess(turningOn)
				turningOn -> requests.requestNotifications()
			}
		},
		requestLibraryAccess = { requests.requestLibraryAccess(false) },
		openSettings = requests.openSettings,
	)
}

private fun needsNotificationPermission(context: Context): Boolean =
	Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
		ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED

@Composable
internal fun PhotosSection(model: MainViewModel, state: MainUiState, controls: PhotoBackupControls, folders: List<LibraryFolder>, onOpenFolders: () -> Unit) {
	SettingsSection("Photos") {
		val destination = state.otherBackupDeviceName
		if (destination != null) {
			PhotoBackupDestinationRow(model, state, destination, controls.access)
			return@SettingsSection
		}
		val preference = controls.preference
		SettingsToggleRow(Symbols.PhotoLibrary, "Back up photos", preference.includesPhotos, onCheckedChange = {
			controls.setPreference(preference.copy(includesPhotos = it))
		})
		SettingsDivider()
		SettingsToggleRow(Symbols.Videocam, "Back up videos", preference.includesVideos, onCheckedChange = {
			controls.setPreference(preference.copy(includesVideos = it))
		})
		SettingsDivider()
		// With "Select photos" access the selection decides what's backed up, so there are no folders to choose.
		if (canChooseFolders(state)) {
			val skipped = skippedFolders(state, folders).size
			SettingsRow(Symbols.Folder, "Folders", modifier = Modifier.clickable(role = Role.Button, onClick = onOpenFolders)) {
				SettingsValue(if (skipped == 0) "All" else "$skipped skipped", chevron = true)
			}
			SettingsDivider()
		}
		// iOS adds a Settings shortcut under this row when its per-app Cellular Data switch is
		// off. Android has no public API for reading a per-app mobile data switch like it.
		SettingsToggleRow(Symbols.Antenna, "Use mobile data", preference.allowsCellular, iconSize = 19.dp, onCheckedChange = {
			controls.setPreference(preference.copy(allowsCellular = it))
		})
		state.backupStatistics?.lastUploadedAtMs?.let { uploadedAt ->
			val context = LocalContext.current
			SettingsDivider()
			SettingsRow(Symbols.History, "Last backed up", iconSize = 20.dp) {
				SettingsValue(lastBackupText(uploadedAt, System.currentTimeMillis(), is24Hour = DateFormat.is24HourFormat(context)))
			}
		}
	}
}

/**
 * Like a phone backup's "Last successful backup": a date, which reads as a fact rather than
 * an age that can look like a stall after a quiet few days. "Today at 3:04 PM", a weekday
 * within the past week, then a date.
 */
internal fun lastBackupText(
	atMs: Long,
	nowMs: Long,
	zone: ZoneId = ZoneId.systemDefault(),
	locale: Locale = Locale.getDefault(),
	is24Hour: Boolean = false,
): String {
	val date = Instant.ofEpochMilli(atMs).atZone(zone)
	val now = Instant.ofEpochMilli(nowMs).atZone(zone)
	fun format(skeleton: String) = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale).format(date)
	val time = format(if (is24Hour) "Hm" else "hm")
	val days = ChronoUnit.DAYS.between(date.toLocalDate(), now.toLocalDate())
	return when {
		days == 0L -> "Today at $time"
		days == 1L -> "Yesterday at $time"
		days in 2..6 -> "${format("EEEE")} at $time"
		date.year == now.year -> format("MMMd")
		else -> format("yMMMd")
	}
}

/**
 * Backup belongs to another saved Umbrel account, so this one's toggles are hidden and the
 * row offers the confirmed switch instead.
 */
@Composable
private fun PhotoBackupDestinationRow(model: MainViewModel, state: MainUiState, destination: String, access: PhotoAccess) {
	val canSwitch = canSwitchBackupHere(access)
	val switching = backupSwitchInProgress(state)
	PhotoBackupSwitchConfirmation(model, destination, access) { confirm ->
		Row(
			// PillButton keeps a 7 dp margin under its capsule for its 44 dp tap target
			Modifier.fillMaxWidth().padding(start = 8.dp, end = 12.dp, top = 12.dp, bottom = if (canSwitch) 5.dp else 12.dp),
			horizontalArrangement = Arrangement.spacedBy(4.dp),
		) {
			// One subheadline line tall, so the icon sits on the first line of the title.
			Box(Modifier.width(30.dp).height(20.dp), contentAlignment = Alignment.Center) {
				Icon(Symbols.PhotoLibrary, contentDescription = null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(18.dp))
			}
			Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
				Text(
					"Photo Backup is on for $destination",
					style = AppleType.subheadline,
					fontWeight = FontWeight.Medium,
					color = Color.White.copy(alpha = 0.9f),
				)
				Text(
					"This phone can back up to one Umbrel at a time.",
					style = AppleType.footnote,
					fontWeight = FontWeight.Medium,
					color = MainTheme.gray,
				)
				if (!canSwitch) {
					Text(
						"Allow photo access to back up to this Umbrel instead.",
						style = AppleType.footnote,
						fontWeight = FontWeight.Medium,
						color = MainTheme.gray,
					)
				} else {
					PillButton(
						if (switching) "Switching backup…" else "Back Up to This Umbrel",
						isLoading = switching,
						onClick = confirm,
					)
				}
			}
		}
	}
}

/**
 * Before the first request the system prompt is the way in, and full access shows as done.
 * Unlike iOS, Android asks again after a single denial, and with partial access its dialog
 * offers a new selection or full access, so both of those request instead of opening
 * Settings. Settings is the way in once the system no longer asks.
 */
@Composable
internal fun PhotoLibraryAccessRow(controls: PhotoBackupControls) {
	val access = controls.access
	LimitedAccessChoices(controls.allPhotosNeedSettings, selectMore = controls.requestLibraryAccess, openSettings = controls.openSettings) { chooseLimitedAccess, menu ->
		val action = when (access) {
			PhotoAccess.FULL -> null
			PhotoAccess.BLOCKED -> controls.openSettings
			PhotoAccess.LIMITED -> chooseLimitedAccess
			PhotoAccess.NOT_DETERMINED, PhotoAccess.DENIED -> controls.requestLibraryAccess
		}
		SettingsRow(
			Symbols.Photo,
			"Photo Library Access",
			modifier = if (action != null) Modifier.clickable(role = Role.Button, onClick = action) else Modifier,
		) {
			if (access == PhotoAccess.FULL) {
				Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
					Icon(Symbols.CheckMedium, contentDescription = null, tint = MainTheme.gray, modifier = Modifier.size(16.dp))
					Text(access.label, style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = MainTheme.gray)
				}
			} else {
				// The menu opens from the value that was tapped, as a row's menu does on iOS.
				Box {
					SettingsValue(access.label, chevron = true)
					menu()
				}
			}
		}
	}
}

/**
 * What tapping "Select photos" access offers. While Android's dialog still offers "Allow
 * all", it is the choice, so the tap asks again. Once it shows only its photo picker
 * ([PhotoAccessRequests.allPhotosNeedSettings]), a menu offers selecting more photos or
 * allowing all, which says where that is before opening Settings. Settings opens only from
 * that tap: Android asks apps not to send people there to change their mind. [content]
 * places the menu in the Box it should open from.
 */
@Composable
internal fun LimitedAccessChoices(
	allPhotosNeedSettings: Boolean,
	selectMore: () -> Unit,
	openSettings: () -> Unit,
	content: @Composable (choose: () -> Unit, menu: @Composable BoxScope.() -> Unit) -> Unit,
) {
	var choosing by remember { mutableStateOf(false) }
	var explainingSettings by remember { mutableStateOf(false) }
	content({ if (allPhotosNeedSettings) choosing = true else selectMore() }) {
		GlassMenu(choosing, onDismissRequest = { choosing = false }) {
			GlassMenuItem("Select More Photos") {
				choosing = false
				selectMore()
			}
			GlassMenuItem("Allow All Photos") {
				choosing = false
				explainingSettings = true
			}
		}
	}
	if (explainingSettings) {
		AlertDialog(
			onDismissRequest = { explainingSettings = false },
			title = { Text("Allow All Photos in Settings") },
			text = { Text("Tap Permissions, then Photos and videos, and choose to allow all.") },
			confirmButton = {
				TextButton(onClick = {
					explainingSettings = false
					openSettings()
				}) { Text("Open Settings") }
			},
			dismissButton = { TextButton(onClick = { explainingSettings = false }) { Text("Cancel") } },
		)
	}
}

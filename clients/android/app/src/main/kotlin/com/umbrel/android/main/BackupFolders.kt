package com.umbrel.android.main

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.InfoPageDivider
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PageSheet
import com.umbrel.android.ui.PrimaryActionButton
import com.umbrel.android.ui.SheetToolbar
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.settingsSwitchColors
import kotlinx.coroutines.launch

/**
 * The Folders page, from Profile › Photos or Library's "N folders skipped": the phone's
 * folders, each with a switch. A folder that's off is skipped; what's already backed up
 * from it stays on the Umbrel.
 */
@Composable
internal fun FoldersPage(model: MainViewModel, state: MainUiState, folders: List<LibraryFolder>, modifier: Modifier = Modifier) {
	val skipped = state.backupPreference.skippedFolders
	val backedUp = folders.count { it.key !in skipped }
	FolderChoice(
		model,
		state,
		folders,
		title = if (backedUp == folders.size) "Backing up all folders" else "Backing up $backedUp of ${folders.size} folders",
		message = "New folders are backed up automatically. Anything already backed up remains on your Umbrel.",
		modifier = modifier,
	)
}

/**
 * The folder choice that comes with turning backup on, before anything uploads: the only
 * moment a folder can be kept off the Umbrel entirely. Everything starts on. A switch saves
 * at once, since backup waits for this choice, and leaving counts as Start Backup.
 */
@Composable
internal fun FolderSetupPage(model: MainViewModel, state: MainUiState, folders: List<LibraryFolder>, onStart: () -> Unit, modifier: Modifier = Modifier) {
	Column(modifier) {
		FolderChoice(
			model,
			state,
			folders,
			title = "Choose folders to back up",
			message = "Everything is on. Skip any folders you don’t want on your Umbrel.",
			modifier = Modifier.weight(1f),
		)
		PrimaryActionButton("Start Backup", Modifier.padding(horizontal = 20.dp, vertical = 12.dp), onClick = onStart)
	}
}

/** The folder choice on its own, when Profile isn't open to show it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FolderSetupSheet(model: MainViewModel, state: MainUiState, folders: List<LibraryFolder>) {
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	val scope = rememberCoroutineScope()
	PageSheet(onDismissRequest = model::confirmFolderChoice, sheetState = sheetState) {
		SheetColumn {
			SheetToolbar("Photo Backup", onClose = null)
			FolderSetupPage(model, state, folders, onStart = {
				scope.launch { sheetState.hide() }.invokeOnCompletion { model.confirmFolderChoice() }
			}, modifier = Modifier.weight(1f))
		}
	}
}

/** The Folders page as a sheet over Library. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FoldersSheet(model: MainViewModel, state: MainUiState, folders: List<LibraryFolder>, onDismiss: () -> Unit) {
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	val scope = rememberCoroutineScope()
	PageSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
		SheetColumn {
			SheetToolbar("Folders", onClose = {
				scope.launch { sheetState.hide() }.invokeOnCompletion { if (!sheetState.isVisible) onDismiss() }
			})
			FoldersPage(model, state, folders)
		}
	}
}

@Composable
private fun SheetColumn(content: @Composable ColumnScope.() -> Unit) {
	Column(Modifier.fillMaxHeight().navigationBarsPadding().background(MainTheme.sheet), content = content)
}

@Composable
private fun FolderChoice(
	model: MainViewModel,
	state: MainUiState,
	folders: List<LibraryFolder>,
	title: String,
	message: String,
	modifier: Modifier = Modifier,
) {
	val skipped = state.backupPreference.skippedFolders
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
			Box(Modifier.size(76.dp).background(Color.White.copy(alpha = 0.08f), CircleShape), contentAlignment = Alignment.Center) {
				Icon(Symbols.FolderSemibold, contentDescription = null, tint = Color.White, modifier = Modifier.size(34.dp))
			}
			Text(title, style = AppleType.title2, fontWeight = FontWeight.Bold, color = Color.White, textAlign = TextAlign.Center)
			Text(message, style = AppleType.subheadline, color = MainTheme.gray, textAlign = TextAlign.Center)
		}
		if (folders.isNotEmpty()) {
			Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
				Text(
					"On this phone",
					style = AppleType.footnote,
					fontWeight = FontWeight.SemiBold,
					color = MainTheme.gray,
					modifier = Modifier.padding(horizontal = 4.dp),
				)
				Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MainTheme.sheetRow)) {
					folders.forEachIndexed { index, folder ->
						FolderRow(folder, backedUp = folder.key !in skipped, onToggle = { model.setFolderSkipped(folder.key, skipped = !it) })
						if (index < folders.lastIndex) InfoPageDivider()
					}
				}
			}
		}
	}
}

/** A folder's newest thumbnail, name and contents, and the switch that backs it up. */
@Composable
private fun FolderRow(folder: LibraryFolder, backedUp: Boolean, onToggle: (Boolean) -> Unit) {
	val context = LocalContext.current
	Row(
		Modifier
			.fillMaxWidth()
			.toggleable(value = backedUp, role = Role.Switch, onValueChange = onToggle)
			.padding(horizontal = 12.dp, vertical = 10.dp),
		horizontalArrangement = Arrangement.spacedBy(12.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		AsyncImage(
			model = remember(folder.newest.localIdentifier, folder.newest.generation) { thumbnailRequest(context, folder.newest) },
			contentDescription = null,
			contentScale = ContentScale.Crop,
			modifier = Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.06f)),
		)
		Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
			Text(
				folder.name,
				style = AppleType.subheadline,
				fontWeight = FontWeight.SemiBold,
				color = Color.White,
				maxLines = 1,
				overflow = TextOverflow.MiddleEllipsis,
			)
			Text(LibraryFolders.contents(folder.photoCount, folder.videoCount), style = AppleType.footnote, color = MainTheme.gray, maxLines = 1)
		}
		Switch(checked = backedUp, onCheckedChange = null, colors = settingsSwitchColors())
	}
}

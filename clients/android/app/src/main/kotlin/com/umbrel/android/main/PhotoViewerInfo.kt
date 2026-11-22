package com.umbrel.android.main

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.LocalBrandColor
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.Symbols

/** Photos' column of cards on a screen wider than a phone's. */
internal val PhotoViewerInfoMaxWidth = 574.dp

// iOS's separator and secondary fill in dark mode.
private val Separator = Color(0xFF545458).copy(alpha = 0.65f)
private val BadgeFill = Color(0xFF787880).copy(alpha = 0.32f)

/**
 * The viewer's Info cards, the port of iOS's PhotoViewerInfo: Photos' Info without what this
 * app can't edit (caption, date and keywords) or leaves out (location), and with the backup
 * status Photos doesn't have.
 */
@Composable
internal fun PhotoViewerInfo(
	item: LocalMediaItem,
	library: PhotoLibraryViewModel,
	state: MainUiState,
	folder: LibraryFolder?,
	onSkipFolder: ((LibraryFolder) -> Unit)?,
	modifier: Modifier = Modifier,
) {
	val context = LocalContext.current
	// Null until it has been read, so the card can wait without claiming anything.
	val metadata by produceState<PhotoViewerMetadata?>(null, item.localIdentifier, item.generation) {
		value = PhotoViewerMetadata.load(context, item)
	}
	Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp)) {
		DetailsCard(item, metadata)
		BackupCard(item, library, state, folder, onSkipFolder)
	}
}

@Composable
private fun InfoCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
	Column(modifier.fillMaxWidth().clip(RoundedCornerShape(MainTheme.cardRadius)).background(MainTheme.sheet)) { content() }
}

@Composable
private fun CardDivider() {
	HorizontalDivider(thickness = Dp.Hairline, color = Separator)
}

/** SwiftUI's placeholder redaction: a rounded bar where the text will be. */
private fun Modifier.redacted(redacted: Boolean, color: Color): Modifier =
	if (!redacted) {
		this
	} else {
		clearAndSetSemantics {}.drawWithContent {
			val inset = size.height * 0.15f
			drawRoundRect(color.copy(alpha = color.alpha * 0.25f), Offset(0f, inset), Size(size.width, size.height - inset * 2), CornerRadius(4.dp.toPx()))
		}
	}

@Composable
private fun DetailsCard(item: LocalMediaItem, metadata: PhotoViewerMetadata?) {
	val context = LocalContext.current
	val loading = metadata == null
	// A photo that can't be read isn't the same as a photo that records no camera.
	val showsCameraDetails = !item.isVideo && metadata?.isOriginalUnavailable != true
	val cameraLine = metadata?.camera ?: when {
		item.isVideo -> "Video"
		metadata?.isOriginalUnavailable == true -> "Camera information unavailable"
		else -> "No camera information"
	}
	val sizeLine = listOfNotNull(
		if (item.isVideo) null else PhotoViewerMetadata.megapixelsText(item.width, item.height),
		if (item.width > 0 && item.height > 0) "${item.width} × ${item.height}" else null,
		metadata?.bytes?.let(PhotoViewerMetadata::fileSizeText),
		item.durationMs?.let(PhotoLibrary::formatLongDuration),
	).joinToString(" • ")
	InfoCard {
		Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
			// The date too, which would otherwise visibly change once the camera's clock is read.
			Text(
				(metadata ?: PhotoViewerMetadata()).dateLine(context, item),
				style = AppleType.subheadline,
				color = Color.White,
				modifier = Modifier.redacted(loading, Color.White),
			)
			(metadata?.name ?: if (loading) "Name" else null)?.let { name ->
				Text(
					name,
					style = AppleType.subheadline,
					color = MainTheme.gray,
					maxLines = 1,
					overflow = TextOverflow.MiddleEllipsis,
					modifier = Modifier.redacted(loading, MainTheme.gray),
				)
			}
		}
		CardDivider()
		Row(
			Modifier.padding(horizontal = 16.dp, vertical = 11.dp),
			horizontalArrangement = Arrangement.spacedBy(8.dp),
			verticalAlignment = Alignment.CenterVertically,
		) {
			Box(Modifier.weight(1f)) {
				Text(
					cameraLine,
					style = AppleType.subheadline,
					color = Color.White,
					maxLines = 1,
					overflow = TextOverflow.Ellipsis,
					modifier = Modifier.redacted(loading, Color.White),
				)
			}
			metadata?.format?.let { Badge(it) }
		}
		CardDivider()
		Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
			if (showsCameraDetails) {
				Text(
					metadata?.lens ?: "No lens information",
					style = AppleType.subheadline,
					color = MainTheme.gray,
					modifier = Modifier.redacted(loading, MainTheme.gray),
				)
			}
			Text(sizeLine, style = AppleType.subheadline, color = MainTheme.gray, modifier = Modifier.redacted(loading, MainTheme.gray))
		}
		if (showsCameraDetails) {
			CardDivider()
			ExposureRow(metadata?.exposure ?: PhotoViewerMetadata.NoExposure, loading)
		}
	}
}

@Composable
private fun Badge(text: String) {
	Text(
		text,
		style = AppleType.caption2,
		fontWeight = FontWeight.Medium,
		color = Color.White,
		modifier = Modifier.background(BadgeFill, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
	)
}

/**
 * Photos keeps all five cells, with a dash for a setting the photo doesn't record. It spaces
 * the values evenly by their own widths, and a row of dashes in equal cells.
 */
@Composable
private fun ExposureRow(exposure: List<String?>, loading: Boolean) {
	val isEmpty = exposure.all { it == null }
	Row(
		Modifier
			.fillMaxWidth()
			.padding(horizontal = 16.dp, vertical = 13.dp)
			.clearAndSetSemantics { if (!loading) contentDescription = exposure.joinToString(", ") { it ?: "-" } },
		verticalAlignment = Alignment.CenterVertically,
	) {
		exposure.forEachIndexed { index, value ->
			if (index > 0) {
				if (!isEmpty) Spacer(Modifier.weight(1f).widthIn(min = 4.dp))
				VerticalDivider(Modifier.height(16.dp), thickness = Dp.Hairline, color = Separator)
				if (!isEmpty) Spacer(Modifier.weight(1f).widthIn(min = 4.dp))
			}
			Text(
				value ?: "-",
				style = AppleType.footnote,
				color = MainTheme.gray,
				textAlign = TextAlign.Center,
				maxLines = 1,
				softWrap = false,
				modifier = (if (isEmpty) Modifier.weight(1f) else Modifier.widthIn(min = 28.dp)).redacted(loading, MainTheme.gray),
			)
		}
	}
}

// Regular weight in the Info card, as iOS draws them, against semibold in the status pill.
private val ViewerBackupStatus.cardIcon
	get() = when (this) {
		ViewerBackupStatus.BACKED_UP -> Symbols.CheckCircle
		ViewerBackupStatus.WAITING -> Symbols.Schedule
		ViewerBackupStatus.NOT_BACKED_UP -> Symbols.RemoveCircleOutline
	}

@Composable
private fun BackupCard(
	item: LocalMediaItem,
	library: PhotoLibraryViewModel,
	state: MainUiState,
	folder: LibraryFolder?,
	onSkipFolder: ((LibraryFolder) -> Unit)?,
) {
	var confirmingSkip by remember { mutableStateOf(false) }
	val status = rememberBackupStatus(item, library, state)
	InfoCard {
		Row(
			Modifier.padding(horizontal = 16.dp, vertical = 14.dp).semantics(mergeDescendants = true) {},
			horizontalArrangement = Arrangement.spacedBy(if (status == null) 8.dp else 12.dp),
			verticalAlignment = Alignment.CenterVertically,
		) {
			if (status == null) {
				Icon(Symbols.Schedule, contentDescription = null, tint = MainTheme.gray, modifier = Modifier.size(18.dp))
				Text("Checking backup", style = AppleType.subheadline, color = MainTheme.gray)
			} else {
				Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) {
					Icon(
						status.cardIcon,
						contentDescription = null,
						tint = Color.White,
						modifier = Modifier.size(24.dp),
					)
				}
				Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
					Text(status.text, style = AppleType.subheadline, fontWeight = FontWeight.SemiBold, color = Color.White)
					val detail = when (status) {
						ViewerBackupStatus.BACKED_UP -> "Saved to your Umbrel"
						ViewerBackupStatus.NOT_BACKED_UP -> if (item.isVideo) "Video backup is turned off." else "Photo backup is turned off."
						ViewerBackupStatus.WAITING -> null
					}
					if (detail != null) Text(detail, style = AppleType.footnote, color = MainTheme.gray)
				}
			}
		}
		// Android's library holds every app's folders, so backup can skip one from here.
		if (folder != null && onSkipFolder != null) {
			CardDivider()
			Text(
				"Skip This Folder",
				style = AppleType.subheadline,
				color = LocalBrandColor.current,
				modifier = Modifier
					.fillMaxWidth()
					.clickable(role = Role.Button) { confirmingSkip = true }
					.padding(horizontal = 16.dp, vertical = 13.dp),
			)
		}
	}
	if (confirmingSkip && folder != null && onSkipFolder != null) {
		AlertDialog(
			onDismissRequest = { confirmingSkip = false },
			title = { Text("Skip ${folder.name}?") },
			text = {
				Text("${LibraryFolders.contents(folder.photoCount, folder.videoCount, separator = " and ")} in this folder won’t be backed up. Anything already on your Umbrel stays there.")
			},
			confirmButton = {
				TextButton(onClick = {
					confirmingSkip = false
					onSkipFolder(folder)
				}) { Text("Skip Folder") }
			},
			dismissButton = { TextButton(onClick = { confirmingSkip = false }) { Text("Cancel") } },
		)
	}
}

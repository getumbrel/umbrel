package com.umbrel.android.main

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.umbrel.android.ui.GlassMenu
import com.umbrel.android.ui.GlassMenuItem
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.glassControl
import com.umbrel.android.ui.openUrl
import kotlinx.coroutines.launch

/**
 * The glass pill at the top-right of the main tabs and of umbrelOS. Its first button opens
 * umbrelOS and, once there, becomes the way out. Inside umbrelOS it also offers what the
 * page needs, the way an app's title bar does.
 */
@Composable
fun HeaderAccessPill(model: MainViewModel, state: MainUiState, modifier: Modifier = Modifier) {
	val browser = model.browser
	val context = LocalContext.current
	val scope = rememberCoroutineScope()
	var showsPageOptions by remember { mutableStateOf(false) }
	Row(modifier.height(42.dp).clip(CircleShape).glassControl(CircleShape)) {
		// One glyph in one place. It changes on the spot, with nothing fading through it, so
		// this never reads as one button uncovering another.
		if (browser.showsUmbrel) {
			PillIcon(Symbols.CloseMedium, "Close umbrelOS", onClick = browser::closeUmbrel)
		} else {
			PillIcon(Symbols.WebAssetMedium, "Open umbrelOS", enabled = !state.openingBrowser) { model.openDashboard() }
		}
		AnimatedVisibility(
			browser.showsUmbrel,
			enter = fadeIn(tween(200)) + expandHorizontally(tween(200)),
			exit = fadeOut(tween(200)) + shrinkHorizontally(tween(200)),
		) {
			Box {
				PillIcon(Symbols.MoreHoriz, "More") { showsPageOptions = true }
				GlassMenu(showsPageOptions, onDismissRequest = { showsPageOptions = false }) {
					GlassMenuItem("Reload") {
						showsPageOptions = false
						browser.umbrel?.reload()
					}
					GlassMenuItem("Open in Browser") {
						showsPageOptions = false
						browser.umbrel?.let { page ->
							scope.launch { browser.browserUrlForOpening(page)?.let { context.openUrl(it) } }
						}
					}
				}
			}
		}
	}
}

@Composable
private fun PillIcon(icon: ImageVector, description: String, enabled: Boolean = true, onClick: () -> Unit) {
	Box(
		Modifier.size(44.dp, 42.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
		contentAlignment = Alignment.Center,
	) {
		Icon(icon, contentDescription = description, tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.size(24.dp))
	}
}

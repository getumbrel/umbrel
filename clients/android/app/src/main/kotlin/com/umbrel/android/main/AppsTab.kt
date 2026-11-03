package com.umbrel.android.main

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.umbrel.android.ui.AppleType
import com.umbrel.android.ui.BentoGrid
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.PillButton
import com.umbrel.android.ui.PullToRefresh
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.frostBackground
import com.umbrel.android.ui.glassGlint
import com.umbrel.android.ui.isAccessibilityTextSize

/**
 * The Apps tab: every installed app over the wallpaper, an app and update count, and links
 * into the Umbrel App Store. Unlike Home, the icons sit directly on the wallpaper.
 */
@Composable
fun AppsTab(model: MainViewModel, state: MainUiState, contentPadding: PaddingValues) {
	val accessibility = isAccessibilityTextSize()
	PullToRefresh(onRefresh = { model.refreshVisibleData(RefreshScope.APPS, force = true) }, indicatorTop = contentPadding.calculateTopPadding() - 8.dp) {
		Column(
			Modifier
				.fillMaxSize()
				.verticalScroll(rememberScrollState())
				.padding(contentPadding)
				.padding(horizontal = MainTheme.contentInset),
			verticalArrangement = Arrangement.spacedBy(24.dp),
		) {
			Header(model, state, accessibility)
			val apps = state.installedApps
			val columns = if (accessibility) 2 else 4
			BentoGrid(apps.size, columns) { index, cellModifier ->
				val app = apps[index]
				AppTileButton(
					app,
					preparing = app.id in state.preparingAppIds,
					onClick = { source -> model.launchApp(app, source) },
					modifier = cellModifier.height(100.dp).clip(RoundedCornerShape(MainTheme.tileRadius)),
					labelColor = Color.White,
				)
			}
			if (state.canManageApps) StoreButton { model.openDashboard("/app-store") }
		}
	}
}

/**
 * "Apps" with "N apps · M updates", and a hand-off to umbrelOS for updates: umbrelOS already
 * shows release notes and update progress, so the app doesn't duplicate that.
 */
@Composable
private fun Header(model: MainViewModel, state: MainUiState, accessibility: Boolean) {
	val title = @Composable {
		Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
			Text("Apps", style = AppleType.largeTitle, fontWeight = FontWeight.Bold, color = Color.White)
			// Empty until the first load, so "0 apps" never flashes.
			if (state.didLoad) {
				Text(appsSubtitle(state.installedApps.size, state.updateCount, state.canManageApps), style = AppleType.subheadline, fontWeight = FontWeight.Medium, color = Color.White)
			}
		}
	}
	val updates = @Composable {
		AnimatedVisibility(
			visible = state.canManageApps && state.updateCount > 0,
			enter = fadeIn(tween(350)) + scaleIn(tween(350), initialScale = 0.9f),
			exit = fadeOut(tween(350)) + scaleOut(tween(350), targetScale = 0.9f),
		) {
			PillButton("View Updates") { model.openDashboard("/app-store", listOf("dialog" to "updates")) }
		}
	}
	if (accessibility) {
		Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
			title()
			updates()
		}
	} else {
		Row(verticalAlignment = Alignment.CenterVertically) {
			Box(Modifier.weight(1f)) { title() }
			Box(Modifier.padding(start = 8.dp)) { updates() }
		}
	}
}

/** "12 apps · 2 updates"; updates only show to accounts that can install them. */
internal fun appsSubtitle(appCount: Int, updateCount: Int, canManageApps: Boolean): String {
	val apps = if (appCount == 1) "1 app" else "$appCount apps"
	if (!canManageApps || updateCount <= 0) return apps
	val updates = if (updateCount == 1) "1 update" else "$updateCount updates"
	return "$apps · $updates"
}

/**
 * This action lives in scrolling content, so it uses the same stable wallpaper frost as
 * the cards instead of a live glass effect.
 */
@Composable
private fun StoreButton(onClick: () -> Unit) {
	Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
		Row(
			Modifier
				.widthIn(min = 44.dp)
				.defaultMinSize(minHeight = 52.dp)
				.clip(CircleShape)
				.frostBackground(CircleShape)
				.glassGlint(CircleShape)
				.clickable(role = Role.Button, onClick = onClick)
				.padding(horizontal = 16.dp),
			horizontalArrangement = Arrangement.spacedBy(4.dp),
			verticalAlignment = Alignment.CenterVertically,
		) {
			Icon(Symbols.CircleGridSemibold, contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
			Text("Open Umbrel App Store", style = AppleType.footnote, fontWeight = FontWeight.SemiBold, color = Color.White)
		}
	}
}

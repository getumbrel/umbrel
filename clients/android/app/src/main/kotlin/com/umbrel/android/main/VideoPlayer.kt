package com.umbrel.android.main

import android.graphics.Color as AndroidColor
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.umbrel.android.ui.CircleIconButton
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.Symbols

/**
 * Full-screen playback of one library video. iOS presents the system player
 * (AVPlayerViewController) over the viewer; Android has no system player an app can
 * present, and Media3 is the player Android recommends, with its standard transport
 * controls. Playback claims audio focus as a movie, as iOS activates its playback audio
 * session only when Play is tapped, and pauses when the app leaves the foreground.
 */
@OptIn(UnstableApi::class)
@Composable
fun VideoPlayer(item: LocalMediaItem, onDismiss: () -> Unit) {
	val context = LocalContext.current
	val player = remember(item.localIdentifier) {
		ExoPlayer.Builder(context)
			.setAudioAttributes(
				AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
				true,
			)
			.build()
			.apply {
				setMediaItem(MediaItem.fromUri(item.uri))
				prepare()
				playWhenReady = true
			}
	}
	DisposableEffect(player) { onDispose { player.release() } }
	LifecycleStartEffect(player) { onStopOrDispose { player.pause() } }
	var controlsVisible by remember { mutableStateOf(true) }

	Dialog(
		onDismissRequest = onDismiss,
		properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
	) {
		val view = LocalView.current
		val window = (view.parent as? DialogWindowProvider)?.window
		SideEffect { window?.setWindowAnimations(0) }
		DisposableEffect(window, controlsVisible) {
			if (window != null) {
				val controller = WindowCompat.getInsetsController(window, view)
				controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
				controller.isAppearanceLightStatusBars = false
				if (controlsVisible) controller.show(WindowInsetsCompat.Type.statusBars()) else controller.hide(WindowInsetsCompat.Type.statusBars())
			}
			onDispose {}
		}
		Box(Modifier.fillMaxSize().background(Color.Black)) {
			AndroidView(
				factory = { viewContext ->
					PlayerView(viewContext).apply {
						this.player = player
						setBackgroundColor(AndroidColor.BLACK)
						setShowNextButton(false)
						setShowPreviousButton(false)
						setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility -> controlsVisible = visibility == android.view.View.VISIBLE })
					}
				},
				modifier = Modifier.fillMaxSize().safeDrawingPadding(),
			)
			// AVPlayerViewController's close control; the back gesture also closes.
			AnimatedVisibility(
				visible = controlsVisible,
				modifier = Modifier.align(Alignment.TopStart).safeDrawingPadding().padding(horizontal = MainTheme.contentInset, vertical = 8.dp),
				enter = fadeIn(),
				exit = fadeOut(),
			) {
				CircleIconButton(Symbols.CloseMedium, contentDescription = "Close", onClick = onDismiss)
			}
		}
	}
}

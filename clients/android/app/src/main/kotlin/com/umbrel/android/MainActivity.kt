package com.umbrel.android

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import coil3.compose.setSingletonImageLoaderFactory
import com.umbrel.android.ui.UmbrelTheme

class MainActivity : ComponentActivity() {
	override fun onCreate(savedInstanceState: Bundle?) {
		val splash = installSplashScreen()
		super.onCreate(savedInstanceState)
		// Routing needs to know which Umbrels have a session, which is read off the main
		// thread; holding the splash until then avoids routing on a guess.
		splash.setKeepOnScreenCondition { container.deviceStore.signedIn.value == null }
		// The app is dark-only. The default style follows the system theme, which would draw
		// dark status bar icons over the wallpaper and a light scrim behind 3-button navigation.
		enableEdgeToEdge(
			statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
			navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
		)
		setContent {
			setSingletonImageLoaderFactory { context -> context.container.imageLoader }
			UmbrelTheme {
				RootView()
			}
		}
	}
}

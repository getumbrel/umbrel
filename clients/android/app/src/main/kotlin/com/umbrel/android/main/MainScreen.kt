package com.umbrel.android.main

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.toSize
import androidx.compose.ui.util.fastCoerceIn
import androidx.compose.ui.util.fastRoundToInt
import androidx.compose.ui.util.lerp
import androidx.compose.ui.zIndex
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.rememberViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.emptyBackdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberCombinedBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.Shadow
import com.umbrel.android.browser.LocalBrowserSources
import com.umbrel.android.browser.PresentedBrowser
import com.umbrel.android.browser.UmbrelOSLayer
import com.umbrel.android.ui.CircleIconButton
import com.umbrel.android.ui.GlassMenuHost
import com.umbrel.android.ui.LocalBrandColor
import com.umbrel.android.ui.LocalFrostWallpaper
import com.umbrel.android.ui.LocalGlassBackdrop
import com.umbrel.android.ui.LocalWallpaperViewport
import com.umbrel.android.ui.MainTheme
import com.umbrel.android.ui.Symbols
import com.umbrel.android.ui.WallpaperBackground
import com.umbrel.android.ui.WallpaperTopGradient
import com.umbrel.android.ui.frostBackground
import com.umbrel.android.ui.glassGlint
import com.umbrel.android.ui.interFor
import com.umbrel.android.ui.liquid.DampedDragAnimation
import com.umbrel.android.ui.liquid.InteractiveHighlight
import com.umbrel.android.ui.openUrl
import com.umbrel.kit.SavedDevice
import kotlin.math.abs
import kotlin.math.sign
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

enum class MainTab(val title: String, val icon: ImageVector, val scope: RefreshScope) {
	HOME("Home", Symbols.Home, RefreshScope.HOME),
	APPS("Apps", Symbols.AppsDiamond, RefreshScope.APPS),
	LIBRARY("Photos", Symbols.PhotoLibraryFilled, RefreshScope.LIBRARY),
}

// The floating tab bar's height. Tab content scrolls underneath it.
private val TabBarHeight = 62.dp

/**
 * One connected Umbrel: Home, Apps and Library tabs plus the Profile sheet, over the
 * account's wallpaper. Profile is a tab-bar item that opens its sheet without changing the
 * selected tab.
 */
@Composable
fun MainScreen(device: SavedDevice, onSignedOut: () -> Unit, onShowAllDevices: () -> Unit, onReconnect: suspend () -> Unit) {
	val context = LocalContext.current
	// Scoped to this screen so signing out and back in, or opening another Umbrel, starts
	// from fresh state.
	val owner = rememberViewModelStoreOwner()
	val model: MainViewModel = viewModel(viewModelStoreOwner = owner) { MainViewModel(context, device.id) }
	val library: PhotoLibraryViewModel = viewModel(viewModelStoreOwner = owner) { PhotoLibraryViewModel(context, LibraryBackupReader(model)) }
	val state by model.state.collectAsStateWithLifecycle()
	val libraryState by library.state.collectAsStateWithLifecycle()
	var tab by rememberSaveable { mutableStateOf(MainTab.HOME) }
	var profileOpen by rememberSaveable { mutableStateOf(false) }
	// The page Profile opens on: Home's connection status opens it at Connection.
	var profileDestination by rememberSaveable { mutableStateOf<ProfileDestination?>(null) }
	var viewport by remember { mutableStateOf(Size.Zero) }
	val snackbar = remember { SnackbarHostState() }
	// Each tab keeps its scroll position while another tab is showing, as a tab view does.
	val tabStates = rememberSaveableStateHolder()

	// General data refreshes only while the app is visible; returning to the foreground
	// performs one full reconciliation.
	LifecycleStartEffect(model) {
		model.start()
		onStopOrDispose { model.stop() }
	}
	// Photo access can change on any resume, including after a permission dialog closes.
	LifecycleResumeEffect(library) {
		library.resume()
		onPauseOrDispose { library.pause() }
	}
	// Android's back gesture follows bottom-navigation convention: another tab returns to
	// Home, and Home goes where its back button does, to all Umbrels.
	BackHandler {
		if (tab == MainTab.HOME) onShowAllDevices() else tab = MainTab.HOME
	}
	val browser = model.browser
	val browserScope = rememberCoroutineScope()
	val showsUmbrel = browser.showsUmbrel
	// Back from umbrelOS returns to the tabs it took over from.
	BackHandler(enabled = showsUmbrel, onBack = browser::closeUmbrel)
	// umbrelOS takes over the screen itself, so anything presented over the tabs (Profile, a
	// setup guide) gets out of its way.
	LaunchedEffect(showsUmbrel) {
		if (!showsUmbrel) return@LaunchedEffect
		profileOpen = false
		model.dismissTailscaleSetup()
	}
	// Whenever the app comes to the foreground with the Umbrel answering, keep the browser
	// session alive and load umbrelOS quietly, so the first time it's opened it is simply there.
	val connected = state.connectionState == ConnectionState.CONNECTED
	LifecycleStartEffect(connected) {
		val work = if (connected) {
			browserScope.launch {
				browser.keepSessionAlive()
				browser.preloadUmbrel()
			}
		} else {
			null
		}
		onStopOrDispose { work?.cancel() }
	}
	// The native tabs and umbrelOS are two layers of content over one wallpaper: the tabs
	// dissolve off it as umbrelOS settles onto it.
	val tabsAlpha by animateFloatAsState(
		if (showsUmbrel) 0f else 1f,
		if (showsUmbrel) tween(180, easing = LinearOutSlowInEasing) else tween(300, delayMillis = 80, easing = LinearOutSlowInEasing),
		label = "tabs",
	)
	LaunchedEffect(device) { model.refreshSavedDevice(device) }
	LaunchedEffect(tab) { model.showTab(tab.scope) }
	LaunchedEffect(profileOpen) { if (profileOpen) model.profileOpened() }
	LaunchedEffect(state.session) { if (state.session == null) onSignedOut() }
	// Turning backup on with access to all photos asks once which folders to back up. A
	// library in a single folder has nothing to choose, so backup starts straight away.
	val choicePending = folderChoicePending(state) && libraryState.loaded
	LaunchedEffect(choicePending, libraryState.folders.size) {
		if (choicePending && libraryState.folders.size <= 1) model.confirmFolderChoice()
	}
	val choosingFolders = choicePending && libraryState.folders.size > 1 && !showsUmbrel
	LaunchedEffect(state.error) {
		state.error?.let {
			snackbar.showSnackbar(it)
			model.clearError()
		}
	}

	val density = LocalDensity.current
	val statusBar = with(density) { WindowInsets.statusBars.getTop(this).toDp() }
	val navigationBar = with(density) { WindowInsets.navigationBars.getBottom(this).toDp() }
	val contentPadding = PaddingValues(top = statusBar + 56.dp, bottom = navigationBar + TabBarHeight + 32.dp)

	CompositionLocalProvider(
		LocalBrowserSources provides browser.sources,
		LocalBrandColor provides state.brandColor,
		LocalFrostWallpaper provides state.blurredWallpaper,
		LocalWallpaperViewport provides viewport,
	) {
		// Glass draws through what's behind it, captured in layers: the tab bar through the
		// wallpaper and the tab, the header through all that and umbrelOS too, and an open
		// menu through everything.
		val underTabBar = rememberLayerBackdrop()
		val underHeader = rememberLayerBackdrop()
		GlassMenuHost(Modifier.fillMaxSize()) {
			// The full window, not the safe area: the backdrop and the card frost both pin the
			// wallpaper to it, and positions measured from the window origin line them up.
			Box(Modifier.fillMaxSize().background(Color.Black).onSizeChanged { viewport = it.toSize() }) {
				Box(Modifier.fillMaxSize().layerBackdrop(underHeader).graphicsLayer()) {
					Box(Modifier.fillMaxSize().layerBackdrop(underTabBar).graphicsLayer()) {
						WallpaperBackground(state.wallpaper)
						Box(Modifier.fillMaxSize().graphicsLayer { alpha = tabsAlpha }.hiddenBehindUmbrel(showsUmbrel)) {
							tabStates.SaveableStateProvider(tab) {
								when (tab) {
									MainTab.HOME -> HomeTab(
										model,
										library,
										state,
										contentPadding,
										onShowApps = { tab = MainTab.APPS },
										onShowLibrary = { tab = MainTab.LIBRARY },
										onShowConnectionDetails = {
											profileDestination = ProfileDestination.CONNECTION
											profileOpen = true
										},
										onReconnect = onReconnect,
									)
									MainTab.APPS -> AppsTab(model, state, contentPadding)
									MainTab.LIBRARY -> LibraryTab(model, library, state, contentPadding)
								}
							}
							SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = navigationBar + TabBarHeight + 8.dp))
						}
					}
					TabBar(
						selected = tab,
						underTabBar = underTabBar,
						onSelect = { tab = it },
						onProfile = {
							profileDestination = null
							profileOpen = true
						},
						modifier = Modifier.align(Alignment.BottomCenter).graphicsLayer { alpha = tabsAlpha }.hiddenBehindUmbrel(showsUmbrel),
					)
					browser.umbrel?.let { UmbrelOSLayer(it, isShown = showsUmbrel) }
				}
				// The status-bar shading and the header belong to neither layer. They are shared by
				// every tab and by umbrelOS, and stay exactly as they are while what's beneath them
				// changes.
				Box(Modifier.fillMaxWidth().zIndex(2f)) {
					WallpaperTopGradient()
					CompositionLocalProvider(LocalGlassBackdrop provides underHeader) {
						HeaderBar(model, state, showsBack = tab == MainTab.HOME && !showsUmbrel, onBack = onShowAllDevices, modifier = Modifier.align(Alignment.TopCenter))
					}
				}
			}
		}
		PresentedBrowser(browser)
		AppLaunchDialogs(model, state)
		PhotoBackupSwitchDialogs(model, state)
		if (profileOpen) {
			ProfileSheet(
				model = model,
				state = state,
				folders = libraryState.folders,
				choosingFolders = choosingFolders,
				destination = profileDestination,
				onDismiss = { profileOpen = false },
			)
		} else if (choosingFolders) {
			FolderSetupSheet(model, state, libraryState.folders)
		} else if (state.tailscaleSetupPresented) {
			// Profile owns any nested setup while it is open, so one sheet shows at a time.
			TailscaleSetupSheet(model, state, onDismiss = model::dismissTailscaleSetup)
		}
	}
}

/**
 * The controls shared by every tab: back to all Umbrels (Home only) and the browser pill.
 * Other tabs hide the back button without removing it, so the pill never shifts.
 */
@Composable
private fun HeaderBar(model: MainViewModel, state: MainUiState, showsBack: Boolean, onBack: () -> Unit, modifier: Modifier = Modifier) {
	Row(
		modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = MainTheme.contentInset),
		verticalAlignment = Alignment.CenterVertically,
	) {
		CircleIconButton(
			Symbols.ArrowBackIosNewMedium,
			contentDescription = "All Umbrels",
			modifier = if (showsBack) Modifier else Modifier.alpha(0f).clearAndSetSemantics {},
			iconSize = 18.dp,
			onClick = { if (showsBack) onBack() },
		)
		Spacer(Modifier.weight(1f))
		HeaderAccessPill(model, state)
	}
}

// Home, Apps and Library, then Profile, which opens its sheet rather than becoming selected.
private val TabBarItemCount = MainTab.entries.size + 1

/**
 * The tab bar, as iOS 26 draws it: a floating capsule of Liquid Glass over the tab, and a
 * lens marking the selected tab that can be pressed and dragged to another. The lens swells
 * while held, stretches with its speed and springs into place; the icons under it show in
 * the accent color. Profile can be tapped or dragged to, but opens its sheet and leaves the
 * lens where it was. [underTabBar] is what the glass draws through; before Android 12, which
 * can't blur it, the bar is frosted wallpaper instead.
 */
@Composable
private fun TabBar(
	selected: MainTab,
	underTabBar: Backdrop,
	onSelect: (MainTab) -> Unit,
	onProfile: () -> Unit,
	modifier: Modifier = Modifier,
) {
	val liquid = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
	val backdrop = if (liquid) underTabBar else emptyBackdrop()
	val iconsBackdrop = rememberLayerBackdrop()
	val animationScope = rememberCoroutineScope()
	val currentSelected by rememberUpdatedState(selected)
	val select by rememberUpdatedState(onSelect)
	val openProfile by rememberUpdatedState(onProfile)
	BoxWithConstraints(
		modifier
			.navigationBarsPadding()
			.padding(horizontal = MainTheme.contentInset)
			.fillMaxWidth()
			.height(TabBarHeight),
		contentAlignment = Alignment.CenterStart,
	) {
		val density = LocalDensity.current
		val isLtr = LocalLayoutDirection.current == LayoutDirection.Ltr
		val tabWidth = with(density) { (constraints.maxWidth - 2 * TabBarInset.toPx()) / TabBarItemCount }
		// Read through state by the gesture and animation objects below, which outlive a resize.
		val currentIsLtr by rememberUpdatedState(isLtr)
		val currentTabWidth by rememberUpdatedState(tabWidth)
		val currentWidth by rememberUpdatedState(constraints.maxWidth)
		// A dragged lens pulls the whole bar up to 4 dp after it, and the bar springs back on release.
		val overscroll = remember { Animatable(0f) }
		val barOffset by remember(density) {
			derivedStateOf {
				val fraction = (overscroll.value / currentWidth).fastCoerceIn(-1f, 1f)
				with(density) { 4.dp.toPx() } * fraction.sign * EaseOut.transform(abs(fraction))
			}
		}
		val lens = remember(animationScope) {
			DampedDragAnimation(
				animationScope = animationScope,
				initialValue = selected.ordinal.toFloat(),
				valueRange = 0f..(TabBarItemCount - 1).toFloat(),
				visibilityThreshold = 0.001f,
				initialScale = 1f,
				pressedScale = 78f / 56f,
				onDragStopped = {
					val index = targetValue.fastRoundToInt().fastCoerceIn(0, TabBarItemCount - 1)
					val tab = MainTab.entries.getOrNull(index)
					if (tab != null && tab != currentSelected) select(tab) else animateToValue(currentSelected.ordinal.toFloat())
					if (tab == null) openProfile()
					animationScope.launch { overscroll.animateTo(0f, spring(1f, 300f, 0.5f)) }
				},
				onDrag = { _, dragAmount ->
					val step = dragAmount.x / currentTabWidth * if (currentIsLtr) 1f else -1f
					updateValue((targetValue + step).fastCoerceIn(0f, (TabBarItemCount - 1).toFloat()))
					animationScope.launch { overscroll.snapTo(overscroll.value + dragAmount.x) }
				},
			)
		}
		// Follows the selection however it changes (a tap, the back gesture), but not into place
		// at first: that would swell the lens as if pressed.
		LaunchedEffect(lens) {
			snapshotFlow { currentSelected }.drop(1).collect { lens.animateToValue(it.ordinal.toFloat()) }
		}
		val highlight = remember(animationScope) {
			InteractiveHighlight(animationScope) { size, _ ->
				val x = (lens.value + 0.5f) * currentTabWidth + barOffset
				Offset(if (currentIsLtr) x else size.width - x, size.height / 2f)
			}
		}
		// The tabs, in the bar where they can be tapped, and in its accent-colored copy where they can't.
		val items: @Composable RowScope.(tint: Color, interactive: Boolean) -> Unit = { tint, interactive ->
			for (tab in MainTab.entries) {
				TabItem(
					tab.title,
					tab.icon,
					tint,
					if (interactive) {
						Modifier.selectable(tab == selected, interactionSource = null, indication = null, role = Role.Tab) {
							if (tab != currentSelected) select(tab)
						}
					} else {
						Modifier
					},
				)
			}
			TabItem(
				"Profile",
				Symbols.Person,
				tint,
				if (interactive) Modifier.clickable(interactionSource = null, indication = null, role = Role.Button, onClick = openProfile) else Modifier,
			)
		}

		// The bar itself.
		Row(
			Modifier
				.graphicsLayer { translationX = barOffset }
				.then(
					if (liquid) {
						Modifier.drawBackdrop(
							backdrop = backdrop,
							shape = { CircleShape },
							effects = {
								vibrancy()
								blur(8.dp.toPx())
								lens(24.dp.toPx(), 24.dp.toPx())
							},
							layerBlock = {
								val scale = lerp(1f, 1f + 16.dp.toPx() / size.width, lens.pressProgress)
								scaleX = scale
								scaleY = scale
							},
							onDrawSurface = { drawRect(TabBarTint) },
						)
					} else {
						Modifier.clip(CircleShape).frostBackground(CircleShape).glassGlint(CircleShape)
					},
				)
				.then(highlight.modifier)
				.fillMaxSize()
				.selectableGroup()
				.padding(TabBarInset),
			verticalAlignment = Alignment.CenterVertically,
		) { items(Color.White, true) }

		// The same icons in the accent color, never shown directly: the lens draws them from
		// this copy, so whatever sits under it reads as selected, enlarged while it's held.
		CompositionLocalProvider(LocalTabItemScale provides { lerp(1f, 1.2f, lens.pressProgress) }) {
			Row(
				Modifier
					.clearAndSetSemantics {}
					.alpha(0f)
					.layerBackdrop(iconsBackdrop)
					.graphicsLayer { translationX = barOffset }
					.drawBackdrop(
						backdrop = backdrop,
						shape = { CircleShape },
						effects = {
							val progress = lens.pressProgress
							vibrancy()
							blur(8.dp.toPx())
							lens(24.dp.toPx() * progress, 24.dp.toPx() * progress)
						},
						highlight = { Highlight.Default.copy(alpha = lens.pressProgress) },
						onDrawSurface = { drawRect(TabBarTint) },
					)
					.then(highlight.modifier)
					.fillMaxWidth()
					.height(TabBarHeight - TabBarInset * 2)
					.padding(horizontal = TabBarInset),
				verticalAlignment = Alignment.CenterVertically,
			) { items(MainTheme.blue, false) }
		}

		// The lens.
		Box(
			Modifier
				.padding(horizontal = TabBarInset)
				.graphicsLayer { translationX = lens.value * tabWidth * (if (isLtr) 1f else -1f) + barOffset }
				.then(highlight.gestureModifier)
				.then(lens.modifier)
				.drawBackdrop(
					backdrop = rememberCombinedBackdrop(backdrop, iconsBackdrop),
					shape = { CircleShape },
					effects = {
						val progress = lens.pressProgress
						lens(10.dp.toPx() * progress, 14.dp.toPx() * progress, chromaticAberration = true)
					},
					highlight = { Highlight.Default.copy(alpha = lens.pressProgress) },
					shadow = { Shadow(alpha = lens.pressProgress) },
					innerShadow = { InnerShadow(radius = 8.dp * lens.pressProgress, alpha = lens.pressProgress) },
					layerBlock = {
						scaleX = lens.scaleX
						scaleY = lens.scaleY
						val velocity = lens.velocity / 10f
						scaleX /= 1f - (velocity * 0.75f).fastCoerceIn(-0.2f, 0.2f)
						scaleY *= 1f - (velocity * 0.25f).fastCoerceIn(-0.2f, 0.2f)
					},
					onDrawSurface = {
						val progress = lens.pressProgress
						drawRect(Color.White.copy(alpha = 0.1f), alpha = 1f - progress)
						drawRect(Color.Black.copy(alpha = 0.03f * progress))
					},
				)
				.height(TabBarHeight - TabBarInset * 2)
				.fillMaxWidth(1f / TabBarItemCount),
		)
	}
}

private val TabBarInset = 4.dp
private val TabBarTint = Color(0xFF121212).copy(alpha = 0.4f)

// How large a tab's icon and title draw: enlarged in the accent copy under a held lens.
private val LocalTabItemScale = staticCompositionLocalOf<() -> Float> { { 1f } }

@Composable
private fun RowScope.TabItem(title: String, icon: ImageVector, tint: Color, modifier: Modifier = Modifier) {
	val scale = LocalTabItemScale.current
	Column(
		modifier
			.weight(1f)
			.fillMaxHeight()
			.graphicsLayer {
				val s = scale()
				scaleX = s
				scaleY = s
			},
		horizontalAlignment = Alignment.CenterHorizontally,
		verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
	) {
		Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(24.dp))
		Text(title, style = TextStyle(fontFamily = interFor(10.sp), fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.SemiBold), color = tint)
	}
}

/**
 * The native tabs while umbrelOS covers them: nothing in them can be touched or read, even
 * where umbrelOS leaves the wallpaper showing through.
 */
private fun Modifier.hiddenBehindUmbrel(hidden: Boolean): Modifier =
	if (!hidden) this
	else clearAndSetSemantics {}.pointerInput(Unit) {
		awaitPointerEventScope {
			while (true) awaitPointerEvent(PointerEventPass.Initial).changes.forEach { it.consume() }
		}
	}

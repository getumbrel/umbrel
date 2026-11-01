package com.umbrel.android

import android.graphics.BitmapFactory
import android.graphics.BlurMaskFilter
import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.calculateTargetValue
import androidx.compose.animation.core.spring
import androidx.compose.animation.splineBasedDecay
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.RenderEffect
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.umbrel.android.ui.glassGlint
import com.umbrel.android.onboarding.shadowBlur
import com.umbrel.android.ui.interFor
import com.umbrel.kit.Umbreld
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.roundToInt

private val AvatarSize = 112.dp
private val LensSize = 156.dp
private val AccountSpacing = 18.dp
private val LensBevel = 50.dp
private val LensRefraction = 35.dp
private const val LensChroma = 0.2f
private val StripHeight = 174.dp

// The lens samples up to this far outside itself, so the refracted layer extends past the
// visible strip by the same amount, as SwiftUI's maxSampleOffset does.
private val LensSampleMargin = LensRefraction * (1 + LensChroma)

// SwiftUI's spring(response: 0.38, dampingFraction: 0.82): stiffness is (2π / 0.38)².
private val SettleSpring = spring<Float>(dampingRatio = 0.82f, stiffness = 273.4f)

/**
 * The native counterpart of umbrelOS's multi-user dock: a strip of avatars under a clear
 * refractive lens. The lens holds still while the strip moves; dragging the lens or tapping
 * an avatar selects an account.
 */
@Composable
internal fun AccountPicker(
	accounts: List<Umbreld.Account>,
	target: Umbreld.Target,
	selectedUserId: String?,
	enabled: Boolean,
	onSelectionChange: (Umbreld.Account) -> Unit,
	modifier: Modifier = Modifier,
) {
	val arranged = remember(accounts) { arrangeAccounts(accounts) }
	var selectedId by remember {
		mutableStateOf(
			selectedUserId
				?: accounts.firstOrNull { it.userId == "0" }?.userId
				?: accounts.firstOrNull()?.userId
				?: "",
		)
	}
	val selectedIndex = arranged.indexOfFirst { it.userId == selectedId }.coerceAtLeast(0)
	val currentIndex by rememberUpdatedState(selectedIndex)
	val currentOnSelectionChange by rememberUpdatedState(onSelectionChange)
	// The strip's position in accounts: whole numbers rest on an account, fractions are
	// mid-drag or mid-settle.
	val position = remember { Animatable(selectedIndex.toFloat()) }
	val scope = rememberCoroutineScope()
	val density = LocalDensity.current
	val stride = with(density) { (AvatarSize + AccountSpacing).toPx() }

	fun select(index: Int) {
		if (arranged.isEmpty()) return
		val bounded = index.coerceIn(0, arranged.lastIndex)
		selectedId = arranged[bounded].userId
		scope.launch { position.animateTo(bounded.toFloat(), SettleSpring) }
		currentOnSelectionChange(arranged[bounded])
	}

	var layerSize by remember { mutableStateOf(IntSize.Zero) }
	val lens = remember(layerSize, density.density) {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && layerSize != IntSize.Zero) {
			accountLensEffect(layerSize, density.density)
		} else {
			null
		}
	}

	Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
		BoxWithConstraints(
			Modifier.fillMaxWidth().height(StripHeight).clipToBounds(),
			contentAlignment = Alignment.Center,
		) {
			val centeredStart = (constraints.maxWidth - with(density) { AvatarSize.toPx() }) / 2
			// The lens refracts the real strip rather than a copy over it, so animation and
			// direct manipulation always render from one source. RuntimeShader needs
			// Android 13; earlier versions show the strip under the clear lens unrefracted.
			Box(
				Modifier
					.fillMaxWidth()
					.requiredHeight(StripHeight + LensSampleMargin * 2)
					.onSizeChanged { layerSize = it }
					.graphicsLayer { renderEffect = lens },
			) {
				arranged.forEachIndexed { index, account ->
					key(account.userId) {
						val isSelected = index == selectedIndex
						AccountAvatar(
							account = account,
							target = target,
							modifier = Modifier
								.align(Alignment.CenterStart)
								.offset { IntOffset((centeredStart + (index - position.value) * stride).roundToInt(), 0) }
								// Disabled buttons draw at half opacity, as on iOS. ModulateAlpha keeps
								// the shadow, which falls outside the avatar's bounds, from being clipped.
								.graphicsLayer {
									alpha = if (enabled) 1f else 0.5f
									compositingStrategy = CompositingStrategy.ModulateAlpha
								}
								.then(
									if (isSelected) {
										// The lens stands in for the selected account.
										Modifier.clearAndSetSemantics {}
									} else {
										Modifier
											.semantics { contentDescription = account.name }
											.clickable(
												interactionSource = null,
												indication = ripple(bounded = false, radius = AvatarSize / 2),
												enabled = enabled,
												onClickLabel = "Move selector to this account",
												role = Role.Button,
											) { select(index) }
									},
								),
						)
					}
				}
			}

			Box(
				Modifier
					.size(LensSize)
					.clip(CircleShape)
					// A SwiftUI shadow takes the alpha of what it shadows. The lens is a 2.5%
					// fill and a hairline rim, so its iOS shadow is too faint to see and is omitted.
					.background(Color.White.copy(alpha = 0.025f))
					.glassGlint(CircleShape, 1.25.dp)
					.semantics {
						contentDescription = "Account"
						stateDescription = arranged.getOrNull(selectedIndex)?.name ?: ""
						progressBarRangeInfo = ProgressBarRangeInfo(
							current = selectedIndex.toFloat(),
							range = 0f..max(arranged.lastIndex, 0).toFloat(),
							steps = max(arranged.size - 2, 0),
						)
						if (enabled) {
							// Adjusting moves one account either way, like iOS's adjustable action.
							setProgress { value ->
								when {
									value > currentIndex -> select(currentIndex + 1)
									value < currentIndex -> select(currentIndex - 1)
								}
								true
							}
						} else {
							disabled()
						}
					}
					.pointerInput(enabled, arranged) {
						if (!enabled) return@pointerInput
						val decay = splineBasedDecay<Float>(this)
						val velocity = VelocityTracker()
						var translation = 0f
						detectHorizontalDragGestures(
							onDragStart = {
								translation = 0f
								velocity.resetTracking()
							},
							onDragEnd = {
								// iOS settles on SwiftUI's predicted end of the drag; Android projects
								// the release velocity with its own fling decay.
								val projected = decay.calculateTargetValue(translation, velocity.calculateVelocity().x)
								select(settledAccountIndex(currentIndex, projected, stride, arranged.size))
							},
							onDragCancel = { select(currentIndex) },
						) { change, amount ->
							change.consume()
							velocity.addPointerInputChange(change)
							translation += amount
							val offset = translation.coerceIn(-(arranged.lastIndex - currentIndex) * stride, currentIndex * stride)
							scope.launch { position.snapTo(currentIndex - offset / stride) }
						}
					},
			)
		}

		Text(
			accountFirstName(arranged.getOrNull(selectedIndex)?.name ?: ""),
			modifier = Modifier.padding(top = 2.dp),
			style = TextStyle(fontFamily = interFor(15.sp), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
			color = Color.White.copy(alpha = 0.9f),
			maxLines = 1,
			overflow = TextOverflow.Ellipsis,
		)
	}
}

@Composable
private fun AccountAvatar(account: Umbreld.Account, target: Umbreld.Target, modifier: Modifier = Modifier) {
	val image by produceState<ImageBitmap?>(null, target.deviceId, account.avatarUrl) {
		value = null
		val path = account.avatarUrl ?: return@produceState
		value = loadAvatar(target, path)
	}
	val density = LocalDensity.current
	Box(
		modifier
			.size(AvatarSize)
			.drawWithCache {
				val paint = android.graphics.Paint().apply {
					isAntiAlias = true
					color = android.graphics.Color.argb(0.28f, 0f, 0f, 0f)
					maskFilter = BlurMaskFilter(shadowBlur(15.dp.toPx()), BlurMaskFilter.Blur.NORMAL)
				}
				onDrawBehind {
					drawIntoCanvas { canvas ->
						canvas.nativeCanvas.drawCircle(center.x, center.y + 9.dp.toPx(), size.minDimension / 2, paint)
					}
				}
			}
			// SwiftUI strokes the rim on the circle's edge, half outside the clip.
			.drawWithContent {
				drawContent()
				drawCircle(Color.White.copy(alpha = 0.22f), radius = size.minDimension / 2, style = Stroke(1.dp.toPx()))
			}
			.clip(CircleShape),
		contentAlignment = Alignment.Center,
	) {
		val loaded = image
		if (loaded != null) {
			Image(
				loaded,
				contentDescription = null,
				modifier = Modifier.fillMaxSize(),
				contentScale = ContentScale.Crop,
				filterQuality = FilterQuality.High,
			)
		} else {
			val gradient = remember(account.userId) { AccountGradient.forId(account.userId) }
			Box(Modifier.fillMaxSize().drawBehind { drawRect(gradient.brush(size)) })
			// A fixed size, as on iOS: the initial scales with the avatar, not with the font setting.
			Text(
				accountInitial(account.name),
				style = TextStyle(
					fontFamily = FontFamily.Serif,
					fontSize = with(density) { (AvatarSize * 0.48f).toSp() },
					color = Color.White,
					shadow = Shadow(
						color = Color.Black.copy(alpha = 0.15f),
						offset = Offset(0f, with(density) { 1.dp.toPx() }),
						blurRadius = shadowBlur(with(density) { 2.dp.toPx() }),
					),
				),
			)
		}
	}
}

private suspend fun loadAvatar(target: Umbreld.Target, path: String): ImageBitmap? = try {
	val data = Umbreld.accountAvatarData(target, path)
	withContext(Dispatchers.Default) {
		BitmapFactory.decodeByteArray(data, 0, data.size)?.apply { prepareToDraw() }?.asImageBitmap()
	}
} catch (cancellation: CancellationException) {
	throw cancellation
} catch (failure: Exception) {
	// The generated gradient stays in place, as it does when an account has no avatar.
	null
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private fun accountLensEffect(size: IntSize, density: Float): RenderEffect {
	val shader = RuntimeShader(AccountLensShader).apply {
		setFloatUniform("size", size.width.toFloat(), size.height.toFloat())
		setFloatUniform("radius", LensSize.value / 2 * density)
		setFloatUniform("bevel", LensBevel.value * density)
		setFloatUniform("scale", LensRefraction.value * density)
		setFloatUniform("chroma", LensChroma)
	}
	return android.graphics.RenderEffect.createRuntimeShaderEffect(shader, "layer").asComposeRenderEffect()
}

// umbrelOS's account lens: a clear convex edge with the refractive index of glass. The
// center stays undistorted while the bevel bends the strip beneath; a small RGB separation
// catches the rim. Lengths are in pixels.
internal const val AccountLensShader = """
uniform shader layer;
uniform float2 size;
uniform float radius;
uniform float bevel;
uniform float scale;
uniform float chroma;

half4 main(float2 position) {
	float2 delta = position - size * 0.5;
	float distanceFromCenter = length(delta);
	float signedDistance = distanceFromCenter - radius;

	if (signedDistance >= 0.0 || -signedDistance > bevel || distanceFromCenter < 0.0001) {
		return layer.eval(position);
	}

	float u = clamp(-signedDistance / bevel, 0.0, 1.0);
	float inverseU = 1.0 - u;
	float slopeDenominator = pow(max(1.0 - pow(inverseU, 4.0), 0.0001), 0.75);
	float slope = pow(inverseU, 3.0) / slopeDenominator;

	const float refractiveIndex = 1.5;
	const float maximumBend = 0.7453559925; // cos(asin(1 / refractiveIndex))
	float incidentAngle = atan(slope);
	float bend = sin(incidentAngle - asin(sin(incidentAngle) / refractiveIndex)) / maximumBend;
	float2 displacement = (delta / distanceFromCenter) * bend * scale;

	half4 redSample = layer.eval(position + displacement * (1.0 + chroma));
	half4 greenSample = layer.eval(position + displacement);
	half4 blueSample = layer.eval(position + displacement * (1.0 - chroma));
	half alpha = max(redSample.a, max(greenSample.a, blueSample.a));

	return half4(redSample.r, greenSample.g, blueSample.b, alpha);
}
"""

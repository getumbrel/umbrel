// Adapted from the catalog app of Kyant0/AndroidLiquidGlass
// (https://github.com/Kyant0/AndroidLiquidGlass). Copyright 2025 Kyant, Apache License 2.0;
// changed for this app.

package com.umbrel.android.ui.liquid

import android.graphics.RuntimeShader
import android.os.Build
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.changedToUpIgnoreConsumed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.util.fastCoerceIn
import androidx.compose.ui.util.fastFirstOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.android.awaitFrame
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * A value dragged across a range, the way Liquid Glass moves a selection: it springs after
 * the finger, swells while held, and stretches with its speed.
 */
class DampedDragAnimation(
	private val animationScope: CoroutineScope,
	initialValue: Float,
	private val valueRange: ClosedRange<Float>,
	visibilityThreshold: Float,
	private val initialScale: Float,
	private val pressedScale: Float,
	private val onDragStopped: DampedDragAnimation.() -> Unit,
	private val onDrag: DampedDragAnimation.(size: IntSize, dragAmount: Offset) -> Unit,
) {
	private val valueAnimationSpec = spring(1f, 1000f, visibilityThreshold)
	private val velocityAnimationSpec = spring(0.5f, 300f, visibilityThreshold * 10f)
	private val pressProgressAnimationSpec = spring(1f, 1000f, 0.001f)
	private val scaleXAnimationSpec = spring(0.6f, 250f, 0.001f)
	private val scaleYAnimationSpec = spring(0.7f, 250f, 0.001f)

	private val valueAnimation = Animatable(initialValue, visibilityThreshold)
	private val velocityAnimation = Animatable(0f, 5f)
	private val pressProgressAnimation = Animatable(0f, 0.001f)
	private val scaleXAnimation = Animatable(initialScale, 0.001f)
	private val scaleYAnimation = Animatable(initialScale, 0.001f)

	private val velocityTracker = VelocityTracker()

	val value: Float get() = valueAnimation.value
	val targetValue: Float get() = valueAnimation.targetValue
	val pressProgress: Float get() = pressProgressAnimation.value
	val scaleX: Float get() = scaleXAnimation.value
	val scaleY: Float get() = scaleYAnimation.value
	val velocity: Float get() = velocityAnimation.value

	val modifier: Modifier = Modifier.pointerInput(Unit) {
		inspectDragGestures(
			onDragStart = { press() },
			onDragEnd = {
				onDragStopped()
				release()
			},
			onDragCancel = {
				onDragStopped()
				release()
			},
		) { _, dragAmount ->
			onDrag(size, dragAmount)
		}
	}

	fun press() {
		velocityTracker.resetTracking()
		animationScope.launch {
			launch { pressProgressAnimation.animateTo(1f, pressProgressAnimationSpec) }
			launch { scaleXAnimation.animateTo(pressedScale, scaleXAnimationSpec) }
			launch { scaleYAnimation.animateTo(pressedScale, scaleYAnimationSpec) }
		}
	}

	fun release() {
		animationScope.launch {
			awaitFrame()
			if (value != targetValue) {
				val threshold = (valueRange.endInclusive - valueRange.start) * 0.025f
				snapshotFlow { valueAnimation.value }
					.filter { abs(it - valueAnimation.targetValue) < threshold }
					.first()
			}
			launch { pressProgressAnimation.animateTo(0f, pressProgressAnimationSpec) }
			launch { scaleXAnimation.animateTo(initialScale, scaleXAnimationSpec) }
			launch { scaleYAnimation.animateTo(initialScale, scaleYAnimationSpec) }
		}
	}

	fun updateValue(value: Float) {
		val target = value.coerceIn(valueRange)
		animationScope.launch {
			launch { valueAnimation.animateTo(target, valueAnimationSpec) { updateVelocity() } }
		}
	}

	fun animateToValue(value: Float) {
		press()
		val target = value.coerceIn(valueRange)
		animationScope.launch { valueAnimation.animateTo(target, valueAnimationSpec) }
		if (velocity != 0f) animationScope.launch { velocityAnimation.animateTo(0f, velocityAnimationSpec) }
		release()
	}

	private fun updateVelocity() {
		velocityTracker.addPosition(System.currentTimeMillis(), Offset(value, 0f))
		val target = velocityTracker.calculateVelocity().x / (valueRange.endInclusive - valueRange.start)
		animationScope.launch { velocityAnimation.animateTo(target, velocityAnimationSpec) }
	}
}

/** The glow that follows a finger across a pressed Liquid Glass surface. */
class InteractiveHighlight(
	private val animationScope: CoroutineScope,
	private val position: (size: Size, offset: Offset) -> Offset = { _, offset -> offset },
) {
	private val pressProgressAnimationSpec = spring(0.5f, 300f, 0.001f)
	private val positionAnimationSpec = spring(0.5f, 300f, Offset.VisibilityThreshold)

	private val pressProgressAnimation = Animatable(0f, 0.001f)
	private val positionAnimation = Animatable(Offset.Zero, Offset.VectorConverter, Offset.VisibilityThreshold)

	private var startPosition = Offset.Zero

	private val shader = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
		RuntimeShader(
			"""
			uniform float2 size;
			layout(color) uniform half4 color;
			uniform float radius;
			uniform float2 position;

			half4 main(float2 coord) {
				float dist = distance(coord, position);
				float intensity = smoothstep(radius, radius * 0.5, dist);
				return color * intensity;
			}
			""".trimIndent(),
		)
	} else {
		null
	}

	val modifier: Modifier = Modifier.drawWithContent {
		val progress = pressProgressAnimation.value
		if (progress > 0f) {
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && shader != null) {
				drawRect(Color.White.copy(0.08f * progress), blendMode = BlendMode.Plus)
				val at = position(size, positionAnimation.value)
				shader.setFloatUniform("size", size.width, size.height)
				shader.setColorUniform("color", Color.White.copy(0.15f * progress).toArgb())
				shader.setFloatUniform("radius", size.minDimension * 1.5f)
				shader.setFloatUniform("position", at.x.fastCoerceIn(0f, size.width), at.y.fastCoerceIn(0f, size.height))
				drawRect(ShaderBrush(shader), blendMode = BlendMode.Plus)
			} else {
				drawRect(Color.White.copy(0.25f * progress), blendMode = BlendMode.Plus)
			}
		}
		drawContent()
	}

	val gestureModifier: Modifier = Modifier.pointerInput(animationScope) {
		inspectDragGestures(
			onDragStart = { down ->
				startPosition = down.position
				animationScope.launch {
					launch { pressProgressAnimation.animateTo(1f, pressProgressAnimationSpec) }
					launch { positionAnimation.snapTo(startPosition) }
				}
			},
			onDragEnd = { settle() },
			onDragCancel = { settle() },
		) { change, _ ->
			animationScope.launch { positionAnimation.snapTo(change.position) }
		}
	}

	private fun settle() {
		animationScope.launch {
			launch { pressProgressAnimation.animateTo(0f, pressProgressAnimationSpec) }
			launch { positionAnimation.animateTo(startPosition, positionAnimationSpec) }
		}
	}
}

/**
 * Reports a press and every move after it without consuming them, so other handlers on the
 * same element still see them while the glass follows the finger.
 */
suspend fun PointerInputScope.inspectDragGestures(
	onDragStart: (down: PointerInputChange) -> Unit = {},
	onDragEnd: (change: PointerInputChange) -> Unit = {},
	onDragCancel: () -> Unit = {},
	onDrag: (change: PointerInputChange, dragAmount: Offset) -> Unit,
) {
	awaitEachGesture {
		val initialDown = awaitFirstDown(false, PointerEventPass.Initial)
		val down = awaitFirstDown(false)
		onDragStart(down)
		onDrag(initialDown, Offset.Zero)
		val up = drag(initialDown.id) { onDrag(it, it.positionChange()) }
		if (up == null) onDragCancel() else onDragEnd(up)
	}
}

private suspend inline fun AwaitPointerEventScope.drag(pointerId: PointerId, onDrag: (PointerInputChange) -> Unit): PointerInputChange? {
	if (currentEvent.changes.fastFirstOrNull { it.id == pointerId }?.pressed != true) return null
	var pointer = pointerId
	while (true) {
		val change = awaitDragOrUp(pointer) ?: return null
		if (change.isConsumed) return null
		if (change.changedToUpIgnoreConsumed()) return change
		onDrag(change)
		pointer = change.id
	}
}

private suspend inline fun AwaitPointerEventScope.awaitDragOrUp(pointerId: PointerId): PointerInputChange? {
	var pointer = pointerId
	while (true) {
		val event = awaitPointerEvent()
		val dragEvent = event.changes.fastFirstOrNull { it.id == pointer } ?: return null
		if (dragEvent.changedToUpIgnoreConsumed()) {
			val otherDown = event.changes.fastFirstOrNull { it.pressed } ?: return dragEvent
			pointer = otherDown.id
		} else if (dragEvent.previousPosition != dragEvent.position) {
			return dragEvent
		}
	}
}

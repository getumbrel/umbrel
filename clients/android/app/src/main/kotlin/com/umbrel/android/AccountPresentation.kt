package com.umbrel.android

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import com.umbrel.kit.Umbreld
import java.text.BreakIterator
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

/**
 * The fallback avatar gradient for an account. Keep this palette and hash in sync with
 * umbrelOS's AccountAvatar: account colours are presentation derived from the immutable id,
 * not stored profile data.
 */
internal class AccountGradient(val stops: List<Pair<Float, Color>>, angleDegrees: Double) {
	/** Unit-square endpoints. CSS angles run clockwise from up; extending the line to the
	 * square's projected corners reproduces CSS's coverage. */
	val start: Offset
	val end: Offset

	init {
		val radians = Math.toRadians(angleDegrees)
		val dx = sin(radians)
		val dy = -cos(radians)
		val length = abs(dx) + abs(dy)
		start = Offset((0.5 - dx * length / 2).toFloat(), (0.5 - dy * length / 2).toFloat())
		end = Offset((0.5 + dx * length / 2).toFloat(), (0.5 + dy * length / 2).toFloat())
	}

	fun brush(size: Size): Brush = Brush.linearGradient(
		*stops.toTypedArray(),
		start = Offset(start.x * size.width, start.y * size.height),
		end = Offset(end.x * size.width, end.y * size.height),
	)

	companion object {
		val all: List<AccountGradient> = listOf(
			mesh(90, 0xFA709A to 0f, 0xFEE140 to 1f),
			mesh(0, 0xE14FAD to 0f, 0xF9D423 to 1f),
			mesh(90, 0xF83600 to 0f, 0xF9D423 to 1f),
			mesh(-60, 0xFF5858 to 0f, 0xF09819 to 1f),
			mesh(0, 0xFF0844 to 0f, 0xFFB199 to 1f),
			mesh(120, 0xF093FB to 0f, 0xF5576C to 1f),
			mesh(-225, 0xFF3CAC to 0f, 0x562B7C to 0.52f, 0x2B86C5 to 1f),
			mesh(-225, 0x231557 to 0f, 0x44107A to 0.29f, 0xFF1361 to 0.67f, 0xFFF800 to 1f),
			mesh(
				0,
				0xFCC5E4 to 0f, 0xFDA34B to 0.15f, 0xFF7882 to 0.35f, 0xC8699E to 0.52f,
				0x7046AA to 0.71f, 0x0C1DB8 to 0.87f, 0x020F75 to 1f,
			),
			mesh(0, 0x3B41C5 to 0f, 0xA981BB to 0.49f, 0xFFC8A9 to 1f),
			mesh(-20, 0xB721FF to 0f, 0x21D4FD to 1f),
			mesh(-225, 0xAC32E4 to 0f, 0x7918F2 to 0.48f, 0x4801FF to 1f),
			mesh(0, 0xF43B47 to 0f, 0x453A94 to 1f),
			mesh(0, 0x30CFD0 to 0f, 0x330867 to 1f),
			mesh(0, 0x007ADF to 0f, 0x00ECBC to 1f),
			mesh(-225, 0xD4FFEC to 0f, 0x57F2CC to 0.48f, 0x4596FB to 1f),
			mesh(-225, 0x2CD8D5 to 0f, 0xC5C1FF to 0.56f, 0xFFBAC3 to 1f),
			mesh(-20, 0xD558C8 to 0f, 0x24D292 to 1f),
			mesh(-60, 0x16A085 to 0f, 0xF4D03F to 1f),
			mesh(
				0,
				0x3F51B1 to 0f, 0x5A55AE to 0.13f, 0x7B5FAC to 0.25f, 0x8F6AAE to 0.38f,
				0xA86AA4 to 0.5f, 0xCC6B8E to 0.62f, 0xF18271 to 0.75f, 0xF3A469 to 0.87f,
				0xF7C978 to 1f,
			),
		)

		/** umbrelOS's 32-bit `hash * 31 + code unit` over UTF-16, then the absolute value. */
		fun index(id: String): Int {
			var hash = 0
			for (unit in id) hash = hash * 31 + unit.code
			return (abs(hash.toLong()) % all.size).toInt()
		}

		fun forId(id: String): AccountGradient = all[index(id)]

		private fun mesh(angle: Int, vararg stops: Pair<Int, Float>) = AccountGradient(
			stops.map { (hex, location) -> location to Color(0xFF000000 or hex.toLong()) },
			angle.toDouble(),
		)
	}
}

/**
 * The picker places the owner in the middle and members alternately to its right and left,
 * matching umbrelOS's multi-user dock.
 */
internal fun arrangeAccounts(accounts: List<Umbreld.Account>): List<Umbreld.Account> {
	val owner = accounts.firstOrNull { it.userId == "0" } ?: return accounts
	val left = mutableListOf<Umbreld.Account>()
	val right = mutableListOf<Umbreld.Account>()
	accounts.filter { it.userId != owner.userId }.forEachIndexed { index, member ->
		if (index % 2 == 0) right += member else left += member
	}
	return left.asReversed() + owner + right
}

internal fun accountFirstName(name: String): String =
	name.trim().takeWhile { !it.isWhitespace() }.ifEmpty { name }

/** The first user-perceived character, so an emoji or accented initial stays whole. */
internal fun accountInitial(name: String): String {
	val trimmed = name.trim()
	if (trimmed.isEmpty()) return ""
	val characters = BreakIterator.getCharacterInstance().apply { setText(trimmed) }
	return trimmed.substring(0, characters.next()).uppercase()
}

/**
 * The account a drag settles on: the selection moves by the projected travel in whole
 * strides, rounding halves away from zero as Swift's `rounded()` does.
 */
internal fun settledAccountIndex(selectedIndex: Int, projectedTranslation: Float, stride: Float, count: Int): Int {
	if (count == 0) return 0
	val last = count - 1
	val clamped = projectedTranslation.coerceIn(-(last - selectedIndex) * stride, selectedIndex * stride)
	val steps = clamped / stride
	val rounded = if (steps < 0) -floor(-steps + 0.5f) else floor(steps + 0.5f)
	return (selectedIndex - rounded.toInt()).coerceIn(0, last)
}

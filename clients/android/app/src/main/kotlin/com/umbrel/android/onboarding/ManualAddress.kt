package com.umbrel.android.onboarding

import com.umbrel.kit.Umbreld
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.job

/**
 * Connect by address: the step it returns to and its check of a typed address. Leaving, by the
 * on-screen or the system Back, cancels the check, and a cancelled check never answers, even
 * from a lookup that finishes anyway, so an Umbrel it finds late can't open sign-in after the
 * screen has gone. Used from the main thread only.
 */
internal class ManualAddress(private val discover: suspend (String) -> Umbreld.ManualDiscoveryResult) {
	private var origin = OnboardingStep.FINDING
	private var running: Job? = null

	fun open(from: OnboardingStep) {
		origin = from
	}

	suspend fun check(address: String): Umbreld.ManualDiscoveryResult = coroutineScope {
		val check = coroutineContext.job
		running = check
		try {
			discover(address)
		} finally {
			if (running === check) running = null
		}
	}

	/**
	 * Leaves the screen for the results as they stand now, along with any Umbrel found at the
	 * address, so its sign-in can't open later. A Back tap while the screen animates away, as
	 * it does after signing in, changes nothing.
	 */
	fun close(state: OnboardingState): OnboardingState {
		if (state.step != OnboardingStep.MANUAL_ADDRESS) return state
		running?.cancel()
		running = null
		return state.copy(step = resultsDestination(origin, state.hasResults), movingForward = false, selectedDevice = null)
	}
}
